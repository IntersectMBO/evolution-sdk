import { describe, expect, it } from "@effect/vitest"

import * as CoreAddress from "../src/Address.js"
import * as CoreAssets from "../src/Assets.js"
import * as Data from "../src/Data.js"
import * as DRep from "../src/DRep.js"
import * as GovernanceAction from "../src/GovernanceAction.js"
import * as NativeScripts from "../src/NativeScripts.js"
import * as ScriptHash from "../src/ScriptHash.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import * as TransactionHash from "../src/TransactionHash.js"
import * as CoreUTxO from "../src/UTxO.js"
import * as VotingProcedures from "../src/VotingProcedures.js"
import { createCoreTestUtxo } from "./utils/utxo-helpers.js"

const PROTOCOL_PARAMS = {
  minFeeCoefficient: 44n,
  minFeeConstant: 155_381n,
  coinsPerUtxoByte: 4_310n,
  maxTxSize: 16_384
}

const CHANGE_ADDRESS =
  "addr_test1qz2fxv2umyhttkxyxp8x0dlpdt3k6cwng5pxj3jhsydzer3n0d3vllmyqwsx5wktcd8cc3sq835lu7drv2xwl2wywfgs68faae"

const baseConfig = { chain: mainnet } satisfies TxBuilderConfig

// A governance action being voted on.
const govActionId = new GovernanceAction.GovActionId({
  transactionId: new TransactionHash.TransactionHash({ hash: new Uint8Array(32).fill(0xcd) }),
  govActionIndex: 0n
})

const yesProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })

// Build a 2-of-3 native (multisig) script and the DRep voter it backs.
const makeMultisigDRep = () => {
  const keyHashes = [0xaa, 0xbb, 0xcc].map((b) => new Uint8Array(28).fill(b))
  const script = NativeScripts.makeScriptNOfK(
    2n,
    keyHashes.map((kh) => NativeScripts.makeScriptPubKey(kh).script)
  )
  const scriptHash = ScriptHash.fromScript(script)
  const voter = new VotingProcedures.DRepVoter({ drep: DRep.fromScriptHash(scriptHash) })
  return { script, scriptHash, voter }
}

describe("TxBuilder NativeScript Vote (native-script DRep)", () => {
  it("builds a vote from a native-script DRep with no redeemer", async () => {
    const { script, voter } = makeMultisigDRep()
    const votingProcedures = VotingProcedures.singleVote(voter, govActionId, yesProcedure)

    const walletUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    const signBuilder = await makeTxBuilder(baseConfig)
      .vote({ votingProcedures })
      .attachScript({ script })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [walletUtxo],
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()

    // The native script must be in the witness set.
    expect(tx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)
    // No redeemers / scriptDataHash / collateral for native-script voting.
    expect(tx.witnessSet.redeemers).toBeUndefined()
    expect(tx.body.scriptDataHash).toBeUndefined()
    expect(tx.body.collateralInputs).toBeUndefined()
    expect(tx.body.votingProcedures).toBeDefined()
  })

  it("builds when .vote() is called before .attachScript() (order-independent)", async () => {
    const { script, voter } = makeMultisigDRep()
    const votingProcedures = VotingProcedures.singleVote(voter, govActionId, yesProcedure)

    const walletUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    // attachScript intentionally placed AFTER vote — the redeemer requirement is resolved
    // at build time, so call order must not matter.
    const signBuilder = await makeTxBuilder(baseConfig)
      .vote({ votingProcedures })
      .payToAddress({
        address: CoreAddress.fromBech32(CHANGE_ADDRESS),
        assets: CoreAssets.fromLovelace(2_000_000n)
      })
      .attachScript({ script })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [walletUtxo],
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)
    expect(tx.witnessSet.redeemers).toBeUndefined()
  })

  it("ignores a redeemer supplied for a native-script voter (no redeemer emitted)", async () => {
    const { script, voter } = makeMultisigDRep()
    const votingProcedures = VotingProcedures.singleVote(voter, govActionId, yesProcedure)

    const walletUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    const signBuilder = await makeTxBuilder(baseConfig)
      .vote({
        votingProcedures,
        redeemer: new Data.Constr({ index: 0n, fields: [] })
      })
      .attachScript({ script })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [walletUtxo],
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)
    // The spurious redeemer must be pruned — native scripts use signatures, not redeemers.
    expect(tx.witnessSet.redeemers).toBeUndefined()
    expect(tx.body.scriptDataHash).toBeUndefined()
  })

  it("still rejects a Plutus-script voter when no redeemer is provided", async () => {
    // A script-hash DRep whose script is NOT a native script (never attached / not resolvable
    // as native) must still require a redeemer.
    const plutusScriptHash = ScriptHash.fromHex("11".repeat(28))
    const voter = new VotingProcedures.DRepVoter({ drep: DRep.fromScriptHash(plutusScriptHash) })
    const votingProcedures = VotingProcedures.singleVote(voter, govActionId, yesProcedure)

    const walletUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    await expect(
      makeTxBuilder(baseConfig)
        .vote({ votingProcedures })
        .build({
          changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
          availableUtxos: [walletUtxo],
          protocolParameters: PROTOCOL_PARAMS
        })
    ).rejects.toThrow(/[Rr]edeemer required/)
  })

  it("sizes the fee for the native script's threshold signers", async () => {
    const { script, voter } = makeMultisigDRep()
    const votingProcedures = VotingProcedures.singleVote(voter, govActionId, yesProcedure)
    const walletUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    const signBuilder = await makeTxBuilder(baseConfig)
      .vote({ votingProcedures })
      .attachScript({ script })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [walletUtxo],
        protocolParameters: PROTOCOL_PARAMS
      })

    // Fee estimation uses fake witnesses; a 2-of-3 native DRep contributes 2 dummy
    // vkey witnesses (its threshold) on top of the 1 wallet-input signer.
    const fakeTx = await signBuilder.toTransactionWithFakeWitnesses()
    expect(fakeTx.witnessSet.vkeyWitnesses?.length ?? 0).toBeGreaterThanOrEqual(3)
  })

  it("classifies a native voter whose script is provided via a reference input", async () => {
    const { script, voter } = makeMultisigDRep()
    const votingProcedures = VotingProcedures.singleVote(voter, govActionId, yesProcedure)
    const walletUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    // The native script is supplied via a reference input rather than .attachScript().
    const refUtxo = new CoreUTxO.UTxO({
      transactionId: TransactionHash.fromHex("b".repeat(64)),
      index: 0n,
      address: CoreAddress.fromBech32(CHANGE_ADDRESS),
      assets: CoreAssets.fromLovelace(5_000_000n),
      scriptRef: script
    })

    const signBuilder = await makeTxBuilder(baseConfig)
      .vote({ votingProcedures })
      .readFrom({ referenceInputs: [refUtxo] })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [walletUtxo],
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.redeemers).toBeUndefined()
    expect(tx.body.referenceInputs?.length ?? 0).toBeGreaterThan(0)
  })

  it("allows a native-script Constitutional Committee voter without a redeemer", async () => {
    const { script, scriptHash } = makeMultisigDRep()
    const voter = new VotingProcedures.ConstitutionalCommitteeVoter({ credential: scriptHash })
    const votingProcedures = VotingProcedures.singleVote(voter, govActionId, yesProcedure)
    const walletUtxo = createCoreTestUtxo({
      transactionId: "a".repeat(64),
      index: 0n,
      address: CHANGE_ADDRESS,
      lovelace: 100_000_000n
    })

    const signBuilder = await makeTxBuilder(baseConfig)
      .vote({ votingProcedures })
      .attachScript({ script })
      .build({
        changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
        availableUtxos: [walletUtxo],
        protocolParameters: PROTOCOL_PARAMS
      })

    const tx = await signBuilder.toTransaction()
    expect(tx.witnessSet.nativeScripts?.length ?? 0).toBeGreaterThan(0)
    expect(tx.witnessSet.redeemers).toBeUndefined()
  })
})
