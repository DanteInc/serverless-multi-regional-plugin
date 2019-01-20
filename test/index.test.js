const Plugin = require('../index')

describe('Plugin', () => {
  it('can be created with basic settings', () => {
    const serverless = { service: {} }
    const options = { stage: 'staging' }
    const plugin = new Plugin(serverless, options)

    expect(plugin.serverless).toBe(serverless)
    expect(plugin.options).toBe(options)
  })

  it('will return assigned regional domain name from build', () => {
    const serverless = {
      service: { custom: { dns: { regionalDomainName: 'regional.domainname.com' } } }
    }
    const options = { stage: 'staging' }
    const plugin = new Plugin(serverless, options)
    var regionalDomainName = plugin.buildRegionalDomainName(['test', 'thing', 'com'])
    expect(regionalDomainName).toBe('regional.domainname.com')
  })

  it('will build regional domain name', () => {
    const serverless = {
      service: { custom: { dns: {} } }
    }
    const options = { stage: 'staging' }
    const plugin = new Plugin(serverless, options)
    var regionalDomainName = plugin.buildRegionalDomainName(['test', 'thing', 'com'])
    expect(regionalDomainName).toBe('test-staging.thing.com')
  })

  it('will setup api regional domain settings from explicit settings', async () => {
    const serverless = {
      service: {
        custom: {
          dns: {
            regionalDomainName: 'regional.domainname.com',
            'us-east-1': {
              acmCertificateArn: 'test-certificate'
            }
          }
        }
      }
    }
    const options = { stage: 'staging', region: 'us-east-1' }
    const plugin = new Plugin(serverless, options)
    plugin.regionalDomainName = 'regional.domainname.com'

    const resources = {
      Resources: { ApiRegionalDomainName: { Properties: {} } }
    }

    await plugin.prepareApiRegionalDomainSettings(resources)

    expect(resources.Resources.ApiRegionalDomainName.Properties.DomainName).toBe(
      'regional.domainname.com'
    )
    expect(resources.Resources.ApiRegionalDomainName.Properties.RegionalCertificateArn).toBe(
      'test-certificate'
    )
  })
})
