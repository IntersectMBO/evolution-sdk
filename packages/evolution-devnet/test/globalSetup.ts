import { Effect } from "effect"

import * as Config from "../src/Config.js"
import * as Images from "../src/Images.js"

const REQUIRED_IMAGES = [
  Config.DEFAULT_DEVNET_CONFIG.image,
  Config.DEFAULT_KUPO_CONFIG.image,
  Config.DEFAULT_OGMIOS_CONFIG.image
]

// Pre-pull every image the integration tests need.
// Concurrent test forks would otherwise race dockerode's image pull stream.
export default async function setup(): Promise<void> {
  for (const image of REQUIRED_IMAGES) {
    await Effect.runPromise(Images.ensureAvailableEffect(image))
  }
}
