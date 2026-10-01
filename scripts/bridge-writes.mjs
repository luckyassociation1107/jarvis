// Cross-platform explicit write-enabled bridge entry point.
process.env.JARVIS_ALLOW_WRITES = '1'
await import('../bridge/server.mjs')
