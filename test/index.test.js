const Plugin = require('../index')

function createServerlessStub() {
  return {
    service: {
      custom: {
        dns: {
          domainName: 'somedomain.example.com'
        }
      }
    }
  }
}

describe('Plugin', () => {
  it('can be created with basic settings', () => {
    const serverless = createServerlessStub()
    const options = { stage: 'staging' }
    const plugin = new Plugin(serverless, options)

    expect(plugin.serverless).toBe(serverless)
    expect(plugin.options).toBe(options)
  })

  it('will return assigned regional domain name from build', () => {
    const serverless = createServerlessStub()
    serverless.service.custom.dns.regionalDomainName = 'regional.domainname.com'

    const options = { stage: 'staging' }
    const plugin = new Plugin(serverless, options)
    var regionalDomainName = plugin.buildRegionalDomainName(['test', 'thing', 'com'])
    expect(regionalDomainName).toBe('regional.domainname.com')
  })

  it('will build regional domain name', () => {
    const serverless = createServerlessStub()
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

  it('will retrieve certificate if not set', async () => {
    const serverless = createServerlessStub()
    const options = { stage: 'staging', region: 'us-east-1' }
    const plugin = new Plugin(serverless, options)
    plugin.getCertArnFromHostName = () => {
      return Promise.resolve('test-cert-arn')
    }

    const resources = {
      Resources: { ApiRegionalDomainName: { Properties: {} } }
    }

    await plugin.prepareApiRegionalDomainSettings(resources)

    expect(resources.Resources.ApiRegionalDomainName.Properties.RegionalCertificateArn).toBe(
      'test-cert-arn'
    )
  })

  it('will set API regional base path', async () => {
    const serverless = createServerlessStub()
    const options = { stage: 'staging', region: 'us-east-1' }
    const plugin = new Plugin(serverless, options)

    const resources = {
      Resources: {
        ApiGatewayStubDeployment: { Properties: {} },
        ApiRegionalBasePathMapping: { Properties: {} }
      }
    }

    await plugin.prepareApiRegionalBasePathMapping(resources)

    expect(resources.Resources.ApiGatewayStubDeployment.Properties.StageName).toBe('staging')
    expect(resources.Resources.ApiRegionalBasePathMapping.Properties.Stage).toBe('staging')
  })

  it('will set API regional endpoint', async () => {
    const serverless = createServerlessStub()
    const options = { stage: 'staging', region: 'us-east-1' }
    const plugin = new Plugin(serverless, options)
    plugin.hostName = 'example.com'

    const resources = {
      Resources: {
        ApiRegionalEndpointRecord: { Properties: {} }
      },
      Outputs: { RegionalEndpoint: { Value: { ['Fn::Join']: ['', '', ''] } } }
    }

    await plugin.prepareApiRegionalEndpointRecord(resources)

    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.HostedZoneName).toBe(
      'example.com.'
    )
    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.HostedZoneId).toBeUndefined()
    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.Region).toBe('us-east-1')
    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.SetIdentifier).toBe('us-east-1')
  })

  it('will set API regional endpoint hosted zone ID if present', async () => {
    const serverless = createServerlessStub()
    serverless.service.custom.dns.hostedZoneId = 'test-hosted-zone-id'
    const options = { stage: 'staging', region: 'us-east-1' }
    const plugin = new Plugin(serverless, options)
    plugin.hostName = 'example.com'

    const resources = {
      Resources: {
        ApiRegionalEndpointRecord: { Properties: {} }
      },
      Outputs: { RegionalEndpoint: { Value: { ['Fn::Join']: ['', '', ''] } } }
    }

    await plugin.prepareApiRegionalEndpointRecord(resources)

    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.HostedZoneName).toBeUndefined()
    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.HostedZoneId).toBe(
      'test-hosted-zone-id'
    )
    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.Region).toBe('us-east-1')
    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.SetIdentifier).toBe('us-east-1')
  })

  it('will set API regional health check to default', async () => {
    const serverless = createServerlessStub()
    const options = { stage: 'staging', region: 'us-east-1' }
    const plugin = new Plugin(serverless, options)

    const resources = {
      Resources: {
        ApiRegionalEndpointRecord: { Properties: {} },
        ApiRegionalHealthCheck: { Properties: { HealthCheckConfig: {} } }
      }
    }

    await plugin.prepareApiRegionalHealthCheck(resources)
    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.HealthCheckId).toBeUndefined()
    expect(
      resources.Resources.ApiRegionalHealthCheck.Properties.HealthCheckConfig.ResourcePath
    ).toBe('/staging/healthcheck')
  })

  it('will set API regional health check to specified path', async () => {
    const serverless = createServerlessStub()
    serverless.service.custom.dns.healthCheckResourcePath = '/test/resource/path'
    const options = { stage: 'staging', region: 'us-east-1' }
    const plugin = new Plugin(serverless, options)

    const resources = {
      Resources: {
        ApiRegionalEndpointRecord: { Properties: {} },
        ApiRegionalHealthCheck: { Properties: { HealthCheckConfig: {} } }
      }
    }

    await plugin.prepareApiRegionalHealthCheck(resources)
    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.HealthCheckId).toBeUndefined()
    expect(
      resources.Resources.ApiRegionalHealthCheck.Properties.HealthCheckConfig.ResourcePath
    ).toBe('/test/resource/path')
  })

  it('will set API regional health check ID to specified value', async () => {
    const serverless = createServerlessStub()
    serverless.service.custom.dns['us-east-1'] = { healthCheckId: 'test-health-check-id' }
    const options = { stage: 'staging', region: 'us-east-1' }
    const plugin = new Plugin(serverless, options)

    const resources = {
      Resources: {
        ApiRegionalEndpointRecord: { Properties: {} },
        ApiRegionalHealthCheck: { Properties: { HealthCheckConfig: {} } }
      }
    }

    await plugin.prepareApiRegionalHealthCheck(resources)
    expect(resources.Resources.ApiRegionalEndpointRecord.Properties.HealthCheckId).toBe(
      'test-health-check-id'
    )
    expect(resources.Resources.ApiRegionalHealthCheck).toBeUndefined()
  })
})
