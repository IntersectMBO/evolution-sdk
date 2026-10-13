/**
 * A REAL Plutus cost model, for the offline measurement.
 *
 * ⚠️ Not a placeholder, and not optional. A measurement is a price times a count: with a toy cost
 * model the counts are real and the prices are not, so every recorded ex-unit figure would be
 * wrong by a factor nobody can see. An EMPTY model is worse — it prices every builtin at zero, so
 * the VM answers with costs of 0 and the budget derived from them is rejected on submission.
 *
 * PROVENANCE: the `cost_models` of `packages/evolution/test/provider/fixtures/koios/epoch_params
 * .json`, a committed Koios response at **epoch 315, protocol 11.0**. Vendored here
 * rather than read out of another package's test fixtures, so the harness depends on data it owns,
 * and rather than fetched, so it runs with no network. ⚠️ **It goes stale**: a protocol parameter
 * update changes these numbers and every budget derived from them. Refresh it from a current
 * `epoch_params` response, and re-record the measurements in `Budgets.ts` when it moves.
 *
 * ⚠️ The V1 and V2 arrays are the fixture's own, 332 entries each, which is not the arity those
 * languages are documented to have. They are carried unexamined because the CIP-113 framework is
 * Plutus V3 throughout and nothing here evaluates a V1 or V2 script; do not reuse them elsewhere
 * without checking.
 */
import { CostModel } from "@evolution-sdk/evolution"

const PLUTUS_V1: ReadonlyArray<bigint> = [
    100788n, 420n, 1n, 1n, 1000n, 173n, 0n, 1n, 1000n, 59957n, 4n, 1n, 11183n, 32n, 201305n, 8356n, 4n, 16000n,
    100n, 16000n, 100n, 16000n, 100n, 16000n, 100n, 16000n, 100n, 16000n, 100n, 100n, 100n, 16000n, 100n, 94375n,
    32n, 132994n, 32n, 61462n, 4n, 72010n, 178n, 0n, 1n, 22151n, 32n, 91189n, 769n, 4n, 2n, 85848n, 228465n, 122n,
    0n, 1n, 1n, 1000n, 42921n, 4n, 2n, 30623n, 28755n, 75n, 1n, 898148n, 27279n, 1n, 51775n, 558n, 1n, 39184n,
    1000n, 60594n, 1n, 141895n, 32n, 83150n, 32n, 15299n, 32n, 76049n, 1n, 13169n, 4n, 22100n, 10n, 28999n, 74n, 1n,
    28999n, 74n, 1n, 43285n, 552n, 1n, 44749n, 541n, 1n, 33852n, 32n, 68246n, 32n, 72362n, 32n, 7243n, 32n, 7391n,
    32n, 11546n, 32n, 85848n, 228465n, 122n, 0n, 1n, 1n, 90434n, 519n, 0n, 1n, 74433n, 32n, 85848n, 228465n, 122n,
    0n, 1n, 1n, 85848n, 228465n, 122n, 0n, 1n, 1n, 270652n, 22588n, 4n, 1457325n, 64566n, 4n, 20467n, 1n, 4n, 0n,
    141992n, 32n, 100788n, 420n, 1n, 1n, 81663n, 32n, 59498n, 32n, 20142n, 32n, 24588n, 32n, 20744n, 32n, 25933n,
    32n, 24623n, 32n, 53384111n, 14333n, 10n, 955506n, 213312n, 0n, 2n, 43053543n, 10n, 43574283n, 26308n, 10n,
    16000n, 100n, 16000n, 100n, 962335n, 18n, 2780678n, 6n, 442008n, 1n, 52538055n, 3756n, 18n, 267929n, 18n,
    76433006n, 8868n, 18n, 52948122n, 18n, 1995836n, 36n, 3227919n, 12n, 901022n, 1n, 166917843n, 4307n, 36n,
    284546n, 36n, 158221314n, 26549n, 36n, 74698472n, 36n, 333849714n, 1n, 254006273n, 72n, 2174038n, 72n, 2261318n,
    64571n, 4n, 207616n, 8310n, 4n, 1293828n, 28716n, 63n, 0n, 1n, 1006041n, 43623n, 251n, 0n, 1n, 100181n, 726n,
    719n, 0n, 1n, 100181n, 726n, 719n, 0n, 1n, 100181n, 726n, 719n, 0n, 1n, 107878n, 680n, 0n, 1n, 95336n, 1n,
    281145n, 18848n, 0n, 1n, 180194n, 159n, 1n, 1n, 158519n, 8942n, 0n, 1n, 159378n, 8813n, 0n, 1n, 107490n, 3298n,
    1n, 106057n, 655n, 1n, 1964219n, 24520n, 3n, 607153n, 231697n, 53144n, 0n, 1n, 116711n, 1957n, 4n, 231883n, 10n,
    1000n, 24838n, 7n, 1n, 232010n, 32n, 321837444n, 25087669n, 18n, 617887431n, 67302824n, 36n, 356924n, 18413n,
    45n, 21n, 219951n, 9444n, 1n, 1000n, 172116n, 183150n, 6n, 24n, 21n, 213283n, 618401n, 1998n, 28258n, 1n, 1000n,
    38159n, 2n, 22n, 1000n, 95933n, 1n, 1n, 11n, 1000n, 277577n, 12n, 21n
]

const PLUTUS_V2: ReadonlyArray<bigint> = [
    100788n, 420n, 1n, 1n, 1000n, 173n, 0n, 1n, 1000n, 59957n, 4n, 1n, 11183n, 32n, 201305n, 8356n, 4n, 16000n,
    100n, 16000n, 100n, 16000n, 100n, 16000n, 100n, 16000n, 100n, 16000n, 100n, 100n, 100n, 16000n, 100n, 94375n,
    32n, 132994n, 32n, 61462n, 4n, 72010n, 178n, 0n, 1n, 22151n, 32n, 91189n, 769n, 4n, 2n, 85848n, 228465n, 122n,
    0n, 1n, 1n, 1000n, 42921n, 4n, 2n, 30623n, 28755n, 75n, 1n, 898148n, 27279n, 1n, 51775n, 558n, 1n, 39184n,
    1000n, 60594n, 1n, 141895n, 32n, 83150n, 32n, 15299n, 32n, 76049n, 1n, 13169n, 4n, 22100n, 10n, 28999n, 74n, 1n,
    28999n, 74n, 1n, 43285n, 552n, 1n, 44749n, 541n, 1n, 33852n, 32n, 68246n, 32n, 72362n, 32n, 7243n, 32n, 7391n,
    32n, 11546n, 32n, 85848n, 228465n, 122n, 0n, 1n, 1n, 90434n, 519n, 0n, 1n, 74433n, 32n, 85848n, 228465n, 122n,
    0n, 1n, 1n, 85848n, 228465n, 122n, 0n, 1n, 1n, 955506n, 213312n, 0n, 2n, 270652n, 22588n, 4n, 1457325n, 64566n,
    4n, 20467n, 1n, 4n, 0n, 141992n, 32n, 100788n, 420n, 1n, 1n, 81663n, 32n, 59498n, 32n, 20142n, 32n, 24588n, 32n,
    20744n, 32n, 25933n, 32n, 24623n, 32n, 43053543n, 10n, 53384111n, 14333n, 10n, 43574283n, 26308n, 10n, 1293828n,
    28716n, 63n, 0n, 1n, 1006041n, 43623n, 251n, 0n, 1n, 16000n, 100n, 16000n, 100n, 962335n, 18n, 2780678n, 6n,
    442008n, 1n, 52538055n, 3756n, 18n, 267929n, 18n, 76433006n, 8868n, 18n, 52948122n, 18n, 1995836n, 36n,
    3227919n, 12n, 901022n, 1n, 166917843n, 4307n, 36n, 284546n, 36n, 158221314n, 26549n, 36n, 74698472n, 36n,
    333849714n, 1n, 254006273n, 72n, 2174038n, 72n, 2261318n, 64571n, 4n, 207616n, 8310n, 4n, 100181n, 726n, 719n,
    0n, 1n, 100181n, 726n, 719n, 0n, 1n, 100181n, 726n, 719n, 0n, 1n, 107878n, 680n, 0n, 1n, 95336n, 1n, 281145n,
    18848n, 0n, 1n, 180194n, 159n, 1n, 1n, 158519n, 8942n, 0n, 1n, 159378n, 8813n, 0n, 1n, 107490n, 3298n, 1n,
    106057n, 655n, 1n, 1964219n, 24520n, 3n, 607153n, 231697n, 53144n, 0n, 1n, 116711n, 1957n, 4n, 231883n, 10n,
    1000n, 24838n, 7n, 1n, 232010n, 32n, 321837444n, 25087669n, 18n, 617887431n, 67302824n, 36n, 356924n, 18413n,
    45n, 21n, 219951n, 9444n, 1n, 1000n, 172116n, 183150n, 6n, 24n, 21n, 213283n, 618401n, 1998n, 28258n, 1n, 1000n,
    38159n, 2n, 22n, 1000n, 95933n, 1n, 1n, 11n, 1000n, 277577n, 12n, 21n
]

const PLUTUS_V3: ReadonlyArray<bigint> = [
    100788n, 420n, 1n, 1n, 1000n, 173n, 0n, 1n, 1000n, 59957n, 4n, 1n, 11183n, 32n, 201305n, 8356n, 4n, 16000n,
    100n, 16000n, 100n, 16000n, 100n, 16000n, 100n, 16000n, 100n, 16000n, 100n, 100n, 100n, 16000n, 100n, 94375n,
    32n, 132994n, 32n, 61462n, 4n, 72010n, 178n, 0n, 1n, 22151n, 32n, 91189n, 769n, 4n, 2n, 85848n, 123203n, 7305n,
    -900n, 1716n, 960n, 57n, 85848n, 0n, 1n, 1n, 1000n, 42921n, 4n, 2n, 30623n, 28755n, 75n, 1n, 898148n, 27279n,
    1n, 51775n, 558n, 1n, 39184n, 1000n, 60594n, 1n, 141895n, 32n, 83150n, 32n, 15299n, 32n, 76049n, 1n, 13169n, 4n,
    22100n, 10n, 28999n, 74n, 1n, 28999n, 74n, 1n, 43285n, 552n, 1n, 44749n, 541n, 1n, 33852n, 32n, 68246n, 32n,
    72362n, 32n, 7243n, 32n, 7391n, 32n, 11546n, 32n, 85848n, 123203n, 7305n, -900n, 1716n, 960n, 57n, 85848n, 0n,
    1n, 90434n, 519n, 0n, 1n, 74433n, 32n, 85848n, 123203n, 7305n, -900n, 1716n, 960n, 57n, 85848n, 0n, 1n, 1n,
    85848n, 123203n, 7305n, -900n, 1716n, 960n, 57n, 85848n, 0n, 1n, 955506n, 213312n, 0n, 2n, 270652n, 22588n, 4n,
    1457325n, 64566n, 4n, 20467n, 1n, 4n, 0n, 141992n, 32n, 100788n, 420n, 1n, 1n, 81663n, 32n, 59498n, 32n, 20142n,
    32n, 24588n, 32n, 20744n, 32n, 25933n, 32n, 24623n, 32n, 43053543n, 10n, 53384111n, 14333n, 10n, 43574283n,
    26308n, 10n, 16000n, 100n, 16000n, 100n, 962335n, 18n, 2780678n, 6n, 442008n, 1n, 52538055n, 3756n, 18n,
    267929n, 18n, 76433006n, 8868n, 18n, 52948122n, 18n, 1995836n, 36n, 3227919n, 12n, 901022n, 1n, 166917843n,
    4307n, 36n, 284546n, 36n, 158221314n, 26549n, 36n, 74698472n, 36n, 333849714n, 1n, 254006273n, 72n, 2174038n,
    72n, 2261318n, 64571n, 4n, 207616n, 8310n, 4n, 1293828n, 28716n, 63n, 0n, 1n, 1006041n, 43623n, 251n, 0n, 1n,
    100181n, 726n, 719n, 0n, 1n, 100181n, 726n, 719n, 0n, 1n, 100181n, 726n, 719n, 0n, 1n, 107878n, 680n, 0n, 1n,
    95336n, 1n, 281145n, 18848n, 0n, 1n, 180194n, 159n, 1n, 1n, 158519n, 8942n, 0n, 1n, 159378n, 8813n, 0n, 1n,
    107490n, 3298n, 1n, 106057n, 655n, 1n, 1964219n, 24520n, 3n, 607153n, 231697n, 53144n, 0n, 1n, 116711n, 1957n,
    4n, 231883n, 10n, 1000n, 24838n, 7n, 1n, 232010n, 32n, 321837444n, 25087669n, 18n, 617887431n, 67302824n, 36n,
    356924n, 18413n, 45n, 21n, 219951n, 9444n, 1n, 1000n, 172116n, 183150n, 6n, 24n, 21n, 213283n, 618401n, 1998n,
    28258n, 1n, 1000n, 38159n, 2n, 22n, 1000n, 95933n, 1n, 1n, 11n, 1000n, 277577n, 12n, 21n
]

/** The cost models the measurement prices scripts with. */
export const COST_MODELS = new CostModel.CostModels({
  PlutusV1: new CostModel.CostModel({ costs: PLUTUS_V1 }),
  PlutusV2: new CostModel.CostModel({ costs: PLUTUS_V2 }),
  PlutusV3: new CostModel.CostModel({ costs: PLUTUS_V3 }),
})

/** The flattened V3 model, for the `script_data_hash` the body commits to. */
export const PLUTUS_V3_COSTS: ReadonlyArray<bigint> = PLUTUS_V3
