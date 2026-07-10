output "cluster_name" { value = aws_ecs_cluster.this.name }
output "cluster_arn" { value = aws_ecs_cluster.this.arn }
output "service_names" { value = { for name, service in aws_ecs_service.this : name => service.name } }
output "task_definition_arns" { value = { for name, task in aws_ecs_task_definition.this : name => task.arn } }
output "namespace_name" { value = aws_service_discovery_private_dns_namespace.this.name }
