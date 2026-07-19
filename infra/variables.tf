variable "aws_region" {
  description = "AWS region to deploy into"
  type        = string
  default     = "us-east-1"
}

variable "nightscout_url" {
  description = "Base URL of the Nightscout API, e.g. https://your-site.com/api/v1"
  type        = string
}

variable "nightscout_api_secret" {
  description = "Nightscout API secret (SHA1-hashed value expected by your instance)"
  type        = string
  sensitive   = true
}

# proxy_api_key is no longer an input — it is generated and rotated per deploy
# by random_password.proxy_api_key. Read it from the `proxy_api_key` output.
