output "alb_dns_name" { value = aws_lb.app.dns_name }
output "ecr_repository_url" { value = aws_ecr_repository.backend.repository_url }
output "document_bucket" { value = aws_s3_bucket.documents.id }
output "database_endpoint" { value = aws_db_instance.postgres.address }
output "kms_key_arn" { value = aws_kms_key.app.arn }
output "database_url_secret_arn" { value = aws_secretsmanager_secret.database_url.arn, sensitive = true }
