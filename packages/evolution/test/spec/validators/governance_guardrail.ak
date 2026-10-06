use cardano/governance.{ProposalProcedure}
use cardano/transaction.{Transaction}

/// Always-succeeding guardrail (constitution) script for testing proposals
/// that must run the constitution script, such as treasury withdrawals and
/// parameter changes.
validator always_yes_guardrail {
  propose(_redeemer: Data, _proposal: ProposalProcedure, _self: Transaction) {
    True
  }

  else(_) {
    False
  }
}
