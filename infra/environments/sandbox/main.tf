data "aws_availability_zones" "available" { state = "available" }

locals { azs = slice(data.aws_availability_zones.available.names, 0, 2) }

resource "aws_vpc" "main" {
  cidr_block = "10.42.0.0/16"
  enable_dns_support = true
  enable_dns_hostnames = true
}

resource "aws_internet_gateway" "main" { vpc_id = aws_vpc.main.id }

resource "aws_subnet" "public" {
  for_each = {
    a = { cidr = "10.42.0.0/24", az = local.azs[0] }
    b = { cidr = "10.42.1.0/24", az = local.azs[1] }
  }
  vpc_id = aws_vpc.main.id
  cidr_block = each.value.cidr
  availability_zone = each.value.az
  map_public_ip_on_launch = true
}

resource "aws_subnet" "data" {
  for_each = {
    a = { cidr = "10.42.10.0/24", az = local.azs[0] }
    b = { cidr = "10.42.11.0/24", az = local.azs[1] }
  }
  vpc_id = aws_vpc.main.id
  cidr_block = each.value.cidr
  availability_zone = each.value.az
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  for_each = aws_subnet.public
  subnet_id = each.value.id
  route_table_id = aws_route_table.public.id
}

resource "aws_kms_key" "app" {
  description = "PRISM sandbox application encryption key"
  deletion_window_in_days = 7
  enable_key_rotation = true
}

resource "aws_kms_alias" "app" {
  name = format("alias/%s", var.name_prefix)
  target_key_id = aws_kms_key.app.key_id
}

resource "aws_s3_bucket" "documents" {
  bucket_prefix = format("%s-documents-", var.name_prefix)
  force_destroy = true
}

resource "aws_s3_bucket_public_access_block" "documents" {
  bucket = aws_s3_bucket.documents.id
  block_public_acls = true
  block_public_policy = true
  ignore_public_acls = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_versioning" "documents" {
  bucket = aws_s3_bucket.documents.id
  versioning_configuration { status = "Enabled" }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "documents" {
  bucket = aws_s3_bucket.documents.id
  rule {
    apply_server_side_encryption_by_default {
      kms_master_key_id = aws_kms_key.app.arn
      sse_algorithm = "aws:kms"
    }
    bucket_key_enabled = true
  }
}

resource "aws_s3_bucket_policy" "documents" {
  bucket = aws_s3_bucket.documents.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid = "DenyInsecureTransport"
      Effect = "Deny"
      Principal = "*"
      Action = "s3:*"
      Resource = [aws_s3_bucket.documents.arn, format("%s/*", aws_s3_bucket.documents.arn)]
      Condition = { Bool = { "aws:SecureTransport" = "false" } }
    }]
  })
}

resource "random_password" "db" {
  length  = 32
  special = true
}
resource "random_password" "jwt" {
  length  = 48
  special = false
}

resource "aws_db_subnet_group" "main" {
  name = format("%s-db", var.name_prefix)
  subnet_ids = [for subnet in aws_subnet.data : subnet.id]
}

resource "aws_security_group" "db" {
  name_prefix = format("%s-db-", var.name_prefix)
  vpc_id = aws_vpc.main.id
}

resource "aws_security_group" "app" {
  name_prefix = format("%s-app-", var.name_prefix)
  vpc_id = aws_vpc.main.id
}

resource "aws_security_group" "alb" {
  name_prefix = format("%s-alb-", var.name_prefix)
  vpc_id = aws_vpc.main.id
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group_rule" "app_from_alb" {
  type = "ingress"
  security_group_id = aws_security_group.app.id
  source_security_group_id = aws_security_group.alb.id
  from_port = 4000
  to_port = 4000
  protocol = "tcp"
}

resource "aws_security_group_rule" "app_egress" {
  type = "egress"
  security_group_id = aws_security_group.app.id
  from_port = 0
  to_port = 0
  protocol = "-1"
  cidr_blocks = ["0.0.0.0/0"]
}

resource "aws_security_group_rule" "db_from_app" {
  type = "ingress"
  security_group_id = aws_security_group.db.id
  source_security_group_id = aws_security_group.app.id
  from_port = 5432
  to_port = 5432
  protocol = "tcp"
}

resource "aws_db_instance" "postgres" {
  identifier = format("%s-postgres", var.name_prefix)
  engine = "postgres"
  engine_version = "16"
  instance_class = var.db_instance_class
  allocated_storage = 20
  max_allocated_storage = 40
  storage_type = "gp3"
  storage_encrypted = true
  kms_key_id = aws_kms_key.app.arn
  db_name = "claim_ai"
  username = "prism_app"
  password = random_password.db.result
  port = 5432
  db_subnet_group_name = aws_db_subnet_group.main.name
  vpc_security_group_ids = [aws_security_group.db.id]
  publicly_accessible = false
  backup_retention_period = 7
  copy_tags_to_snapshot = true
  auto_minor_version_upgrade = true
  deletion_protection = false
  skip_final_snapshot = true
  apply_immediately = true
}

resource "aws_secretsmanager_secret" "database_url" {
  name = format("%s/database-url", var.name_prefix)
  kms_key_id = aws_kms_key.app.arn
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "database_url" {
  secret_id = aws_secretsmanager_secret.database_url.id
  secret_string = format(
    "postgresql://%s:%s@%s:%s/%s?schema=public&sslmode=require",
    aws_db_instance.postgres.username,
    urlencode(random_password.db.result),
    aws_db_instance.postgres.address,
    aws_db_instance.postgres.port,
    aws_db_instance.postgres.db_name
  )
}

resource "aws_secretsmanager_secret" "jwt" {
  name = format("%s/jwt-secret", var.name_prefix)
  kms_key_id = aws_kms_key.app.arn
  recovery_window_in_days = 0
}

resource "aws_secretsmanager_secret_version" "jwt" {
  secret_id = aws_secretsmanager_secret.jwt.id
  secret_string = random_password.jwt.result
}

resource "aws_ecr_repository" "backend" {
  name = format("%s-backend", var.name_prefix)
  image_tag_mutability = "IMMUTABLE"
  image_scanning_configuration { scan_on_push = true }
}

resource "aws_cloudwatch_log_group" "backend" {
  name = format("/ecs/%s/backend", var.name_prefix)
  retention_in_days = 14
  kms_key_id = aws_kms_key.app.arn
}

resource "aws_iam_role" "ecs_execution" {
  name_prefix = format("%s-ecs-exec-", var.name_prefix)
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy_attachment" "ecs_execution" {
  role = aws_iam_role.ecs_execution.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AmazonECSTaskExecutionRolePolicy"
}

resource "aws_iam_role_policy" "ecs_execution_secrets" {
  role = aws_iam_role.ecs_execution.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["secretsmanager:GetSecretValue"], Resource = [aws_secretsmanager_secret.database_url.arn, aws_secretsmanager_secret.jwt.arn] },
      { Effect = "Allow", Action = ["kms:Decrypt"], Resource = [aws_kms_key.app.arn] }
    ]
  })
}

resource "aws_iam_role" "app" {
  name_prefix = format("%s-app-", var.name_prefix)
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{ Effect = "Allow", Principal = { Service = "ecs-tasks.amazonaws.com" }, Action = "sts:AssumeRole" }]
  })
}

resource "aws_iam_role_policy" "app_documents" {
  role = aws_iam_role.app.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      { Effect = "Allow", Action = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], Resource = [format("%s/*", aws_s3_bucket.documents.arn)] },
      { Effect = "Allow", Action = ["s3:ListBucket"], Resource = [aws_s3_bucket.documents.arn] },
      { Effect = "Allow", Action = ["kms:Decrypt", "kms:Encrypt", "kms:GenerateDataKey"], Resource = [aws_kms_key.app.arn] }
    ]
  })
}

resource "aws_ecs_cluster" "main" {
  name = var.name_prefix
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
}

resource "aws_ecs_task_definition" "backend" {
  family = format("%s-backend", var.name_prefix)
  requires_compatibilities = ["FARGATE"]
  network_mode = "awsvpc"
  cpu = var.app_cpu
  memory = var.app_memory
  execution_role_arn = aws_iam_role.ecs_execution.arn
  task_role_arn = aws_iam_role.app.arn

  container_definitions = jsonencode([{
    name = "backend"
    image = var.container_image
    essential = true
    portMappings = [{ containerPort = 4000, hostPort = 4000, protocol = "tcp" }]
    environment = [
      { name = "NODE_ENV", value = "production" },
      { name = "PORT", value = "4000" },
      { name = "AWS_REGION", value = var.aws_region },
      { name = "DOCUMENT_STORAGE_BACKEND", value = "s3" },
      { name = "DOCUMENT_S3_BUCKET", value = aws_s3_bucket.documents.id },
      { name = "DOCUMENT_S3_KMS_KEY_ID", value = aws_kms_key.app.arn },
      { name = "CORS_ORIGIN", value = var.cors_origin },
      { name = "REFRESH_COOKIE_SECURE", value = "true" },
      { name = "HIPAA_BAA_CONFIRMED", value = "false" },
      { name = "PAYER_CONNECTOR_MODE", value = "LOCAL" },
      { name = "STEDI_PRODUCTION_PHI_CONFIRMED", value = "false" },
      { name = "STEDI_PRODUCTION_SUBMISSION_ENABLED", value = "false" }
    ]
    secrets = [
      { name = "DATABASE_URL", valueFrom = aws_secretsmanager_secret.database_url.arn },
      { name = "JWT_SECRET", valueFrom = aws_secretsmanager_secret.jwt.arn }
    ]
    logConfiguration = {
      logDriver = "awslogs"
      options = {
        awslogs-group = aws_cloudwatch_log_group.backend.name
        awslogs-region = var.aws_region
        awslogs-stream-prefix = "backend"
      }
    }
  }])
}

resource "aws_lb" "app" {
  name = substr(replace(var.name_prefix, "_", "-"), 0, 32)
  internal = false
  load_balancer_type = "application"
  security_groups = [aws_security_group.alb.id]
  subnets = [for subnet in aws_subnet.public : subnet.id]
  drop_invalid_header_fields = true
}

resource "aws_lb_target_group" "backend" {
  name = substr(format("%s-api", replace(var.name_prefix, "_", "-")), 0, 32)
  port = 4000
  protocol = "HTTP"
  vpc_id = aws_vpc.main.id
  target_type = "ip"
  health_check {
    path                = "/health/ready"
    healthy_threshold   = 2
    unhealthy_threshold = 3
    matcher             = "200"
  }
}

resource "aws_lb_listener" "http" {
  load_balancer_arn = aws_lb.app.arn
  port = 80
  protocol = "HTTP"
  default_action {
    type = "redirect"
    redirect {
      port        = "443"
      protocol    = "HTTPS"
      status_code = "HTTP_301"
    }
  }
}

resource "aws_lb_listener" "https" {
  load_balancer_arn = aws_lb.app.arn
  port = 443
  protocol = "HTTPS"
  ssl_policy = "ELBSecurityPolicy-TLS13-1-2-2021-06"
  certificate_arn = var.certificate_arn
  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.backend.arn
  }
}

resource "aws_ecs_service" "backend" {
  name = format("%s-backend", var.name_prefix)
  cluster = aws_ecs_cluster.main.id
  task_definition = aws_ecs_task_definition.backend.arn
  desired_count = 1
  launch_type = "FARGATE"

  network_configuration {
    subnets = [for subnet in aws_subnet.public : subnet.id]
    security_groups = [aws_security_group.app.id]
    assign_public_ip = true
  }

  load_balancer {
    target_group_arn = aws_lb_target_group.backend.arn
    container_name = "backend"
    container_port = 4000
  }

  depends_on = [aws_lb_listener.https]
}

resource "aws_cloudwatch_metric_alarm" "alb_5xx" {
  alarm_name = format("%s-alb-5xx", var.name_prefix)
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods = 1
  metric_name = "HTTPCode_Target_5XX_Count"
  namespace = "AWS/ApplicationELB"
  period = 300
  statistic = "Sum"
  threshold = 5
  treat_missing_data = "notBreaching"
  dimensions = { LoadBalancer = aws_lb.app.arn_suffix }
}

resource "aws_cloudwatch_metric_alarm" "ecs_cpu" {
  alarm_name = format("%s-ecs-cpu-high", var.name_prefix)
  comparison_operator = "GreaterThanThreshold"
  evaluation_periods = 2
  metric_name = "CPUUtilization"
  namespace = "AWS/ECS"
  period = 300
  statistic = "Average"
  threshold = 80
  treat_missing_data = "notBreaching"
  dimensions = { ClusterName = aws_ecs_cluster.main.name, ServiceName = aws_ecs_service.backend.name }
}

resource "aws_budgets_budget" "sandbox" {
  name = format("%s-monthly", var.name_prefix)
  budget_type = "COST"
  limit_amount = tostring(var.monthly_budget_usd)
  limit_unit = "USD"
  time_unit = "MONTHLY"

  notification {
    comparison_operator = "GREATER_THAN"
    threshold = 50
    threshold_type = "PERCENTAGE"
    notification_type = "FORECASTED"
    subscriber_email_addresses = [var.budget_email]
  }

  notification {
    comparison_operator = "GREATER_THAN"
    threshold = 90
    threshold_type = "PERCENTAGE"
    notification_type = "ACTUAL"
    subscriber_email_addresses = [var.budget_email]
  }
}
