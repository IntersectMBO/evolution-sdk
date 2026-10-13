/**
 * Transaction outputs.
 *
 * This module used to carry a SECOND, parallel model of a transaction output -- a union of a
 * `ShelleyTransactionOutput` and a `BabbageTransactionOutput` class, with `address: AddressEras`
 * and `amount: Value` -- while `TxOut` carried the one `TransactionBody`, the builders and the
 * sdk actually use (`address: Address`, `assets: Assets`, one class covering both eras).
 *
 * Both were public from the package entry point, under names that gave no hint which was which,
 * and they rejected each other: an output built with this module could not be placed in a
 * `TransactionBody`, and the error said `Expected TransactionOutput, actual [toString threw]`
 * about a value that was a `TransactionOutput` -- the other one.
 *
 * The name now refers to the model that works. Everything here is `TxOut`.
 *
 * @since 2.0.0
 */
export * from "./TxOut.js"
