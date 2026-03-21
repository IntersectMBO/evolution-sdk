use cardano/transaction.{OutputReference, Transaction}

/// Recursive multisig policy type — mirrors the NativeScript structure.
/// Used to verify the blueprint codegen correctly handles self-referential types.
pub type MultiSig {
  /// A single required signature.
  Signature { key_hash: ByteArray }
  /// All scripts must be satisfied (AND).
  AllOf { scripts: List<MultiSig> }
  /// Any one script must be satisfied (OR).
  AnyOf { scripts: List<MultiSig> }
  /// At least `required` scripts must be satisfied (M-of-N).
  AtLeast { required: Int, scripts: List<MultiSig> }
  /// Valid only before this slot.
  Before { time: Int }
  /// Valid only after this slot.
  After { time: Int }
  /// A script hash that must be present.
  Script { script_hash: ByteArray }
}

validator multisig {
  spend(
    _datum: Option<MultiSig>,
    _redeemer: ByteArray,
    _utxo: OutputReference,
    _self: Transaction,
  ) {
    True
  }

  else(_) {
    False
  }
}
