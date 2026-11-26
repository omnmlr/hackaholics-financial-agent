#!/usr/bin/env bash
set -euo pipefail

if [[ $# != 2 || ! $1 =~ ^subnet-[[:xdigit:]]+$ || ! $2 =~ ^[1-9][0-9]*$ ]]; then
  printf 'Usage: bash preflight.sh <Frankfurt-public-subnet-id> <planned-runtime-hours>\n' >&2
  exit 2
fi

region=eu-central-1
subnet=$1
hours=$2
aws sts get-caller-identity --query Arn --output text
read -r plan status credit currency expiry <<< "$(aws freetier get-account-plan-state \
  --region us-east-1 \
  --query '[accountPlanType,accountPlanStatus,accountPlanRemainingCredits.amount,accountPlanRemainingCredits.unit,accountPlanExpirationDate]' \
  --output text)"
estimate=$(awk -v hours="$hours" 'BEGIN { printf "%.2f", hours * (0.024 + 0.005 + 20 * 0.0952 / 730) * 1.10 }')
printf 'Plan %s %s, credits %s %s, expiration %s. Check %s USD for %s hours including a 10%% reserve.\n' \
  "$plan" "$status" "$credit" "$currency" "$expiry" "$estimate" "$hours"
if [[ $plan != FREE || $status != ACTIVE || $currency != USD || ! $credit =~ ^[0-9]+(\.[0-9]+)?$ ]] ||
  ! awk -v credit="$credit" -v estimate="$estimate" 'BEGIN { exit !(credit >= estimate) }' ||
  ! expiry_seconds=$(date -u -d "$expiry" +%s) ||
  ! run_end=$(date -u -d "+$hours hours" +%s) ||
  (( expiry_seconds < run_end )); then
  printf 'The active Free account plan and covered run window must be verified before provision.\n' >&2
  exit 1
fi

read -r vpc zone <<< "$(aws ec2 describe-subnets --region "$region" --subnet-ids "$subnet" \
  --query 'Subnets[0].[VpcId,AvailabilityZone]' --output text)"
eligible=$(aws ec2 describe-instance-types --region "$region" \
  --filters Name=instance-type,Values=t3.small Name=free-tier-eligible,Values=true \
  --query 'InstanceTypes[0].InstanceType' --output text)
offered=$(aws ec2 describe-instance-type-offerings --region "$region" --location-type availability-zone \
  --filters Name=instance-type,Values=t3.small "Name=location,Values=$zone" \
  --query 'InstanceTypeOfferings[0].InstanceType' --output text)
if [[ $eligible != t3.small || $offered != t3.small ]]; then
  printf 'The instance is unavailable or ineligible in the selected availability zone.\n' >&2
  exit 1
fi

route_query="RouteTables[0].Routes[?DestinationCidrBlock=='0.0.0.0/0' && State=='active'].GatewayId | [0]"
gateway=$(aws ec2 describe-route-tables --region "$region" \
  --filters "Name=association.subnet-id,Values=$subnet" --query "$route_query" --output text)
if [[ $gateway == None ]]; then
  gateway=$(aws ec2 describe-route-tables --region "$region" --filters \
    "Name=vpc-id,Values=$vpc" Name=association.main,Values=true --query "$route_query" --output text)
fi
if [[ $gateway != igw-* ]]; then
  printf 'An existing public subnet with a route to an Internet Gateway is required.\n' >&2
  exit 1
fi

printf 'Free Plan credit and t3.small offering verified in %s, VPC %s.\n' "$zone" "$vpc"
