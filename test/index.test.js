const Plugin = require('../index')

describe('Plugin', () => {
  it('can be created with basic settings', () => {
    const serverless = { service: {} }
    const options = { stage: 'staging' }
    const plugin = new Plugin(serverless, options)

    expect(plugin.serverless).toBe(serverless)
    expect(plugin.options).toBe(options)
  })
})
