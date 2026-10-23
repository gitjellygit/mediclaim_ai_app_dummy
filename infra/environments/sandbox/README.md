# PRISM AWS non-PHI sandbox

This Terraform stack is a security/infrastructure test environment, not a HIPAA production environment.

## Hard rule
Use only synthetic or de-identified test data. Do not place real patient PHI, production payer credentials, or production healthcare documents in this sandbox.

## Security baseline
- dedicated VPC
- public HTTPS ALB
- ECS/Fargate task whose inbound application port is restricted to the ALB security group
- private RDS PostgreSQL subnets and no public database endpoint
- private S3 document bucket with Block Public Access, versioning and SSE-KMS
- KMS rotation
- Secrets Manager runtime credentials
- immutable ECR repository with scan-on-push
- encrypted CloudWatch application logs
- 5xx and CPU alarms
- AWS Budget notifications
- payer and LLM production transmission interlocks forced off

## Sandbox cost decision
To avoid a NAT Gateway charge, the NON_PHI sandbox Fargate task uses a public subnet/public IP while accepting inbound application traffic only from the ALB. Production should move application tasks into private subnets with approved controlled egress.

## Before apply
1. Create or verify a dedicated AWS sandbox account and billing alerts.
2. Issue an ACM certificate in the selected region.
3. Build the backend image and push it to ECR.
4. Copy terraform.tfvars.example to terraform.tfvars.
5. Run terraform init, terraform fmt -check, terraform validate, terraform plan.
6. Review the plan before terraform apply.

Terraform state contains generated sandbox credentials. Keep it encrypted and access-controlled. Before real staging or production, move state into an approved remote backend with locking and restricted IAM.

Keep HIPAA_BAA_CONFIRMED, STEDI_PRODUCTION_PHI_CONFIRMED, and STEDI_PRODUCTION_SUBMISSION_ENABLED false in this sandbox.
