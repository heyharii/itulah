#[test]
fn audit_shared_remaining_budget_is_enforced() {
 let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
 let mut envelope = campaign("C1");
 envelope.caps.budget = Some(Money::new(50_000));
 envelope.caps.spent = Money::new(40_000);
 snap.campaigns.push(envelope);
 snap.rules.push(under_campaign("R1", "C1", 5_000));
 snap.rules.push(under_campaign("R2", "C1", 5_000));
 let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
 println!("Remaining 10000, actual discount {}", result.discount_total.minor);
 assert_eq!(result.discount_total, Money::new(10_000));
}

#[test]
fn audit_campaign_remaining_uses_is_enforced() {
 let mut snap = snapshot(vec![entry("SKU1", Level::Company, None, 100_000)], vec![]);
 let mut envelope = campaign("C1");
 envelope.caps.max_uses = Some(1);
 snap.campaigns.push(envelope);
 snap.rules.push(under_campaign("R1", "C1", 1_000));
 snap.rules.push(under_campaign("R2", "C1", 1_000));
 let result = resolved(&snap, &context(), &[CartLine::new("SKU1", 1)]);
 println!("Remaining uses 1, applied campaign rules {}", result.applied_rules.len());
 assert_eq!(result.applied_rules.len(), 1);
}
