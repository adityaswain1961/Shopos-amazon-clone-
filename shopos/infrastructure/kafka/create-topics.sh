#!/usr/bin/env bash
# Create all ShopOS topics (idempotent). Used by the compose `kafka-init` job
# and the Helm `kafka-topics` hook job.
#
# Partition count = the maximum number of consumer instances that can work a
# topic in parallel. You can add partitions later, but not remove them; key
# ordering per entity is preserved because producers key by entity id.
set -euo pipefail

BOOTSTRAP="${BOOTSTRAP:-kafka:29092}"
PARTITIONS="${PARTITIONS:-6}"
REPLICATION="${REPLICATION:-1}"
KT=/opt/kafka/bin/kafka-topics.sh

TOPICS=(
  user.registered user.profile_updated user.account_deleted
  product.created product.updated product.price_dropped product.categories
  order.created order.confirmed order.cancelled order.shipped
  inventory.confirmed inventory.failed inventory.release
  payment.initiate payment.completed payment.failed payment.refund_requested payment.refunded
  review.submitted
)

for t in "${TOPICS[@]}"; do
  "$KT" --bootstrap-server "$BOOTSTRAP" --create --if-not-exists \
        --topic "$t" --partitions "$PARTITIONS" --replication-factor "$REPLICATION" \
        --config min.insync.replicas="$(( REPLICATION > 1 ? 2 : 1 ))"
  # dead-letter topic for messages that keep failing
  "$KT" --bootstrap-server "$BOOTSTRAP" --create --if-not-exists \
        --topic "$t.dlq" --partitions 1 --replication-factor "$REPLICATION" \
        --config retention.ms=1209600000
done

echo "Kafka topics ready"
