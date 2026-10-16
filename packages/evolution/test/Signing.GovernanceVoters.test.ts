import { describe, expect, it } from "vitest"

import * as DRep from "../src/DRep.js"
import * as GovernanceAction from "../src/GovernanceAction.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PoolKeyHash from "../src/PoolKeyHash.js"
import * as PrivateKey from "../src/PrivateKey.js"
import * as ScriptHash from "../src/ScriptHash.js"
import { preprod } from "../src/sdk/client/Chain.js"
import { seedWallet } from "../src/sdk/client/internal/Wallets.js"
import { keysFromSeed } from "../src/sdk/wallet/Derivation.js"
import * as Transaction from "../src/Transaction.js"
import * as TransactionBody from "../src/TransactionBody.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as TransactionWitnessSet from "../src/TransactionWitnessSet.js"
import * as VotingProcedures from "../src/VotingProcedures.js"

const mnemonic =
  "zebra short room flavor rival capital fortune hip profit trust melody office depend adapt visa cycle february link tornado whisper physical kiwi film voyage"

const keys = keysFromSeed(mnemonic)
const stakeKey = PrivateKey.fromBech32(keys.stakeKey!)
const paymentKey = PrivateKey.fromBech32(keys.paymentKey)
const stakeKh = KeyHash.fromPrivateKey(stakeKey)
const paymentKh = KeyHash.fromPrivateKey(paymentKey)

const govActionId = new GovernanceAction.GovActionId({
  transactionId: new TransactionHash.TransactionHash({ hash: new Uint8Array(32).fill(0xcd) }),
  govActionIndex: 0n
})
const yesProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })

const txWithVoter = (voter: VotingProcedures.Voter): Transaction.Transaction =>
  new Transaction.Transaction({
    body: new TransactionBody.TransactionBody({
      inputs: [],
      outputs: [],
      fee: 200_000n,
      votingProcedures: VotingProcedures.singleVote(voter, govActionId, yesProcedure)
    }),
    witnessSet: TransactionWitnessSet.empty(),
    isValid: true,
    auxiliaryData: null
  })

const witnessKeyHashHexes = (ws: TransactionWitnessSet.TransactionWitnessSet): Array<string> =>
  (ws.vkeyWitnesses ?? []).map((w) => KeyHash.toHex(KeyHash.fromVKey(w.vkey)))

describe("signTx adds governance voters to the required signers (#479)", () => {
  it("key-hash DRep voter equal to the wallet stake credential is signed with the stake key", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const voter = new VotingProcedures.DRepVoter({ drep: new DRep.KeyHashDRep({ keyHash: stakeKh }) })

    const witnessSet = await wallet.signTx(txWithVoter(voter))

    expect(witnessKeyHashHexes(witnessSet)).toEqual([KeyHash.toHex(stakeKh)])
  })

  it("key-hash committee voter equal to the wallet stake credential is signed with the stake key", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const voter = new VotingProcedures.ConstitutionalCommitteeVoter({ credential: stakeKh })

    const witnessSet = await wallet.signTx(txWithVoter(voter))

    expect(witnessKeyHashHexes(witnessSet)).toEqual([KeyHash.toHex(stakeKh)])
  })

  it("stake-pool voter equal to the wallet payment key hash is signed with the payment key", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const voter = new VotingProcedures.StakePoolVoter({
      poolKeyHash: new PoolKeyHash.PoolKeyHash({ hash: paymentKh.hash })
    })

    const witnessSet = await wallet.signTx(txWithVoter(voter))

    expect(witnessKeyHashHexes(witnessSet)).toEqual([KeyHash.toHex(paymentKh)])
  })

  it("script-hash DRep voter produces no vkey witness (control)", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const voter = new VotingProcedures.DRepVoter({
      drep: new DRep.ScriptHashDRep({ scriptHash: ScriptHash.fromHex("11".repeat(28)) })
    })

    const witnessSet = await wallet.signTx(txWithVoter(voter))

    expect(witnessKeyHashHexes(witnessSet)).toEqual([])
  })

  it("unrelated key-hash DRep voter produces no vkey witness (control)", async () => {
    const wallet = seedWallet({ mnemonic })(preprod)
    const voter = new VotingProcedures.DRepVoter({
      drep: new DRep.KeyHashDRep({ keyHash: KeyHash.fromHex("22".repeat(28)) })
    })

    const witnessSet = await wallet.signTx(txWithVoter(voter))

    expect(witnessKeyHashHexes(witnessSet)).toEqual([])
  })
})
