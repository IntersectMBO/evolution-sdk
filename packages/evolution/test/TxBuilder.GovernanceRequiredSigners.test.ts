import { describe, expect, it } from "@effect/vitest"

import * as CoreAddress from "../src/Address.js"
import * as DRep from "../src/DRep.js"
import * as GovernanceAction from "../src/GovernanceAction.js"
import * as KeyHash from "../src/KeyHash.js"
import * as PoolKeyHash from "../src/PoolKeyHash.js"
import type { TxBuilderConfig } from "../src/sdk/builders/TransactionBuilder.js"
import { makeTxBuilder } from "../src/sdk/builders/TransactionBuilder.js"
import { mainnet } from "../src/sdk/client/index.js"
import * as TransactionHash from "../src/TransactionHash.js"
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

const govActionId = new GovernanceAction.GovActionId({
  transactionId: new TransactionHash.TransactionHash({ hash: new Uint8Array(32).fill(0xcd) }),
  govActionIndex: 0n
})

const yesProcedure = new VotingProcedures.VotingProcedure({ vote: VotingProcedures.yes(), anchor: null })

const buildVote = async (voter: VotingProcedures.Voter) => {
  const walletUtxo = createCoreTestUtxo({
    transactionId: "a".repeat(64),
    index: 0n,
    address: CHANGE_ADDRESS,
    lovelace: 100_000_000n
  })

  const signBuilder = await makeTxBuilder(baseConfig)
    .vote({ votingProcedures: VotingProcedures.singleVote(voter, govActionId, yesProcedure) })
    .build({
      changeAddress: CoreAddress.fromBech32(CHANGE_ADDRESS),
      availableUtxos: [walletUtxo],
      protocolParameters: PROTOCOL_PARAMS
    })

  return signBuilder.toTransaction()
}

const requiredSignerHexes = (tx: Awaited<ReturnType<typeof buildVote>>): Array<string> =>
  (tx.body.requiredSigners ?? []).map((kh) => KeyHash.toHex(kh))

describe("TxBuilder Vote adds key-hash voters to requiredSigners (#479)", () => {
  it("key-hash DRep voter is added to the body's requiredSigners", async () => {
    const keyHash = KeyHash.fromHex("aa".repeat(28))
    const voter = new VotingProcedures.DRepVoter({ drep: new DRep.KeyHashDRep({ keyHash }) })

    const tx = await buildVote(voter)

    expect(requiredSignerHexes(tx)).toContain(KeyHash.toHex(keyHash))
  })

  it("key-hash committee voter is added to the body's requiredSigners", async () => {
    const keyHash = KeyHash.fromHex("bb".repeat(28))
    const voter = new VotingProcedures.ConstitutionalCommitteeVoter({ credential: keyHash })

    const tx = await buildVote(voter)

    expect(requiredSignerHexes(tx)).toContain(KeyHash.toHex(keyHash))
  })

  it("stake-pool voter is added to the body's requiredSigners", async () => {
    const poolKeyHash = new PoolKeyHash.PoolKeyHash({ hash: KeyHash.fromHex("cc".repeat(28)).hash })
    const voter = new VotingProcedures.StakePoolVoter({ poolKeyHash })

    const tx = await buildVote(voter)

    expect(requiredSignerHexes(tx)).toContain("cc".repeat(28))
  })
})
