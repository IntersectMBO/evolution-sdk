import { Core } from "@evolution-sdk/evolution"
import http from "http"

const server = http.createServer((req, res) => {
  if (req.url === "/") {
    res.writeHead(200, { "Content-Type": "text/html" })
    res.end(`
      <!DOCTYPE html>
      <html>
        <head><title>Evolution SDK Demo</title></head>
        <body>
          <h1>Evolution SDK - Running in Docker</h1>
          <h2>Test Address Conversion</h2>
          <pre id="result">Loading...</pre>
          <script>
            const bech32 = "addr1qx2kd28nq8ac5prwg32hhvudlwggpgfp8utlyqxu6wqgz62f79qsdmm5dsknt9ecr5w468r9ey0fxwkdrwh08ly3tu9sy0f4qd";
            
            fetch("/api/address?bech32=" + bech32)
              .then(r => r.json())
              .then(data => {
                document.getElementById("result").textContent = JSON.stringify(data, null, 2);
              });
          </script>
        </body>
      </html>
    `)
  } else if (req.url?.startsWith("/api/address")) {
    const url = new URL(req.url, `http://${req.headers.host}`)
    const bech32 = url.searchParams.get("bech32")
    
    if (!bech32) {
      res.writeHead(400, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: "Missing bech32 parameter" }))
      return
    }

    try {
      const address = Core.Address.fromBech32(bech32)
      const hex = Core.Address.toHex(address)
      
      res.writeHead(200, { "Content-Type": "application/json" })
      res.end(JSON.stringify({
        bech32,
        hex,
        networkId: address.networkId,
        type: address.type
      }, null, 2))
    } catch (error) {
      res.writeHead(500, { "Content-Type": "application/json" })
      res.end(JSON.stringify({ error: String(error) }))
    }
  } else {
    res.writeHead(404)
    res.end("Not found")
  }
})

const PORT = process.env.PORT || 3000
server.listen(PORT, () => {
  console.log(`🚀 Evolution SDK Demo Server running at http://localhost:${PORT}`)
  console.log(`   Visit http://localhost:${PORT} to test address conversion`)
})
