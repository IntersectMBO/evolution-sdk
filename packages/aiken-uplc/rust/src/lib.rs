use js_sys;
use uplc::tx;
use wasm_bindgen::prelude::*;

// Use `wee_alloc` as the global allocator.
#[global_allocator]
static ALLOC: wee_alloc::WeeAlloc = wee_alloc::WeeAlloc::INIT;

#[wasm_bindgen]
pub fn eval_phase_two_raw(
    tx_bytes: &[u8],
    utxos_bytes_x: Vec<js_sys::Uint8Array>,
    utxos_bytes_y: Vec<js_sys::Uint8Array>,
    cost_mdls_bytes: &[u8],
    initial_budget_n: u64,
    initial_budget_d: u64,
    slot_config_x: u64,
    slot_config_y: u64,
    slot_config_z: u32,
) -> Result<Vec<js_sys::Uint8Array>, JsValue> {
    let utxos_bytes = utxos_bytes_x
        .into_iter()
        .zip(utxos_bytes_y.into_iter())
        .map(|(x, y)| (x.to_vec(), y.to_vec()))
        .collect::<Vec<(Vec<u8>, Vec<u8>)>>();
    return tx::eval_phase_two_raw(
        tx_bytes,
        &utxos_bytes,
        Some(cost_mdls_bytes),
        (initial_budget_n, initial_budget_d),
        (slot_config_x, slot_config_y, slot_config_z),
        false,
        |_| (),
    )
    .map(|r| {
        r.iter()
            .map(|i| js_sys::Uint8Array::from(&i.0[..]))
            .collect()
    })
    .map_err(|e| e.to_string().into());
}

#[cfg(test)]
mod tests {
    use std::cmp::Ordering;

    #[test]
    fn plutus_data_regression_inputs_use_distinct_cbor_forms() {
        let equivalent_encodings = [
            // [1]
            ([0x81, 0x01].as_slice(), [0x9f, 0x01, 0xff].as_slice()),
            // {1: 2}
            (
                [0xa1, 0x01, 0x02].as_slice(),
                [0xbf, 0x01, 0x02, 0xff].as_slice(),
            ),
            // Constr 0 [1]
            (
                [0xd8, 0x79, 0x81, 0x01].as_slice(),
                [0xd8, 0x79, 0x9f, 0x01, 0xff].as_slice(),
            ),
        ];

        for (definite, indefinite) in equivalent_encodings {
            assert_ne!(
                definite, indefinite,
                "the regression case depends on different CBOR container encodings"
            );
        }
    }

    #[test]
    fn plutus_data_equality_ignores_cbor_container_encoding() {
        let equivalent_encodings = [
            // [1]
            ([0x81, 0x01].as_slice(), [0x9f, 0x01, 0xff].as_slice()),
            // {1: 2}
            (
                [0xa1, 0x01, 0x02].as_slice(),
                [0xbf, 0x01, 0x02, 0xff].as_slice(),
            ),
            // Constr 0 [1]
            (
                [0xd8, 0x79, 0x81, 0x01].as_slice(),
                [0xd8, 0x79, 0x9f, 0x01, 0xff].as_slice(),
            ),
        ];

        for (definite, indefinite) in equivalent_encodings {
            let definite = uplc::plutus_data(definite).expect("definite CBOR should decode");
            let indefinite = uplc::plutus_data(indefinite).expect("indefinite CBOR should decode");

            assert_eq!(definite, indefinite);
            assert_eq!(definite.cmp(&indefinite), Ordering::Equal);
        }
    }
}
