terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.aws_region
}

locals {
  function_name = "nightscout-graphql-proxy"
  # Built by `npm run package` (build.mjs) before `terraform apply`.
  zip_path = "${path.module}/../dist/function.zip"
}

# --- Proxy API key: rotated automatically whenever the code bundle changes ---
# The keeper is the zip's hash, so a new build (= a deploy) mints a fresh key,
# while infra-only applies leave it untouched. Read it via:
#   terraform -chdir=infra output -raw proxy_api_key
resource "random_password" "proxy_api_key" {
  length  = 40
  special = false
  keepers = {
    code = filebase64sha256(local.zip_path)
  }
}

# --- IAM: minimal execution role (CloudWatch Logs only) ---
data "aws_iam_policy_document" "assume" {
  statement {
    actions = ["sts:AssumeRole"]
    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "lambda" {
  name               = "${local.function_name}-role"
  assume_role_policy = data.aws_iam_policy_document.assume.json
}

resource "aws_iam_role_policy_attachment" "basic" {
  role       = aws_iam_role.lambda.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"
}

# --- Logs ---
resource "aws_cloudwatch_log_group" "lambda" {
  name              = "/aws/lambda/${local.function_name}"
  retention_in_days = 14
}

# --- Lambda ---
resource "aws_lambda_function" "proxy" {
  function_name    = local.function_name
  role             = aws_iam_role.lambda.arn
  runtime          = "nodejs20.x"
  handler          = "lambda.handler"
  filename         = local.zip_path
  source_code_hash = filebase64sha256(local.zip_path)
  timeout          = 15
  memory_size      = 256

  environment {
    variables = {
      NIGHTSCOUT_URL        = var.nightscout_url
      NIGHTSCOUT_API_SECRET = var.nightscout_api_secret
      PROXY_API_KEY         = random_password.proxy_api_key.result
    }
  }

  depends_on = [aws_cloudwatch_log_group.lambda]
}

# --- Public HTTP API (API Gateway v2) in front of the Lambda ---
# Used instead of a Lambda Function URL because this account blocks
# unauthenticated (AuthType NONE) function URLs. The HTTP API is public;
# auth is still enforced in-app via the x-api-key header. Its payload
# format v2.0 is the same event shape the handler already parses.
resource "aws_apigatewayv2_api" "http" {
  name          = local.function_name
  protocol_type = "HTTP"

  cors_configuration {
    allow_origins = ["*"]
    allow_methods = ["POST", "GET", "OPTIONS"]
    allow_headers = ["content-type", "x-api-key"]
  }
}

resource "aws_apigatewayv2_integration" "lambda" {
  api_id                 = aws_apigatewayv2_api.http.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.proxy.invoke_arn
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "graphql" {
  api_id    = aws_apigatewayv2_api.http.id
  route_key = "ANY /graphql"
  target    = "integrations/${aws_apigatewayv2_integration.lambda.id}"
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.http.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowApiGatewayInvoke"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.proxy.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.http.execution_arn}/*/*"
}
