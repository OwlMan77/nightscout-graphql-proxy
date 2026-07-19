output "api_endpoint" {
  description = "Base HTTP API endpoint"
  value       = aws_apigatewayv2_api.http.api_endpoint
}

output "graphql_endpoint" {
  description = "Full GraphQL endpoint to point clients / MCP server at"
  value       = "${aws_apigatewayv2_api.http.api_endpoint}/graphql"
}

output "proxy_api_key" {
  description = "Current x-api-key value (rotates each deploy). Read with: terraform output -raw proxy_api_key"
  value       = random_password.proxy_api_key.result
  sensitive   = true
}
