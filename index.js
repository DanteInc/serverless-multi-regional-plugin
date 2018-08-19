const path = require('path');
const _ = require('lodash');
const yaml = require('js-yaml');
const fs = require('fs');

class Plugin {
  constructor(serverless, options) {
    this.serverless = serverless;
    this.options = options;
    this.hooks = {
      'before:deploy:createDeploymentArtifacts': this.createDeploymentArtifacts.bind(this),
    };
  }

  createDeploymentArtifacts() {
    if (!this.serverless.service.custom.cdn) {
      this.serverless.service.custom.cdn = {};
    }

    if (!this.serverless.service.custom.dns) {
      this.serverless.service.custom.dns = {};
    }

    const disabled = this.serverless.service.custom.cdn.disabled;
    if (disabled != undefined && disabled) {
      return;
    }

    const regionalDomainName = this.serverless.service.custom.dns.regionalDomainName;
    if (!regionalDomainName) {
      return;
    }

    const baseResources = this.serverless.service.provider.compiledCloudFormationTemplate;

    const filename = path.resolve(__dirname, 'resources.yml');
    const content = fs.readFileSync(filename, 'utf-8');
    const resources = yaml.safeLoad(content, {
      filename: filename
    });

    this.prepareResources(resources);
    return _.merge(baseResources, resources);
  }

  prepareResources(resources) {
    this.prepareApiRegionalDomainName(resources);
    this.prepareApiRegionalEndpointRecord(resources);

    const globalDomainName = this.serverless.service.custom.dns.domainName;
    const cloudFrontRegion = this.serverless.service.custom.cdn.region;
    const enabled = this.serverless.service.custom.cdn.enabled;
    if (!globalDomainName ||
      cloudFrontRegion !== this.options.region ||
      (enabled && !enabled.includes(this.options.stage))) {
      delete resources.Resources.ApiDistribution;
      delete resources.Resources.ApiGlobalEndpointRecord;
      delete resources.Outputs.ApiDistribution;
      delete resources.Outputs.GlobalEndpoint;
      return;
    }

    const distributionConfig = resources.Resources.ApiDistribution.Properties.DistributionConfig;

    this.prepareComment(distributionConfig);
    this.prepareOrigins(distributionConfig);
    this.prepareHeaders(distributionConfig);
    this.preparePriceClass(distributionConfig);
    this.prepareAliases(distributionConfig);
    this.prepareCertificate(distributionConfig);
    this.prepareLogging(distributionConfig);
    this.prepareWaf(distributionConfig);

    this.prepareApiGlobalEndpointRecord(resources);
  }

  prepareApiRegionalDomainName(resources) {
    const properties = resources.Resources.ApiRegionalDomainName.Properties;

    const regionalDomainName = this.serverless.service.custom.dns.regionalDomainName;
    properties.DomainName = regionalDomainName;

    const acmCertificateArn = this.serverless.service.custom.dns[this.options.region].acmCertificateArn;
    if (acmCertificateArn) {
      properties.RegionalCertificateArn = acmCertificateArn;
    } else {
      delete properties.RegionalCertificateArn;
    }
  }

  prepareApiRegionalEndpointRecord(resources) {
    const properties = resources.Resources.ApiRegionalEndpointRecord.Properties;

    const hostedZoneId = this.serverless.service.custom.dns.hostedZoneId;
    if (hostedZoneId) {
      properties.HostedZoneId = hostedZoneId;
    } else {
      delete properties.hostedZoneId;
    }

    properties.Region = this.options.region;
    properties.SetIdentifier = this.options.region;

    const healthCheckId = this.serverless.service.custom.dns[this.options.region].healthCheckId;
    if (healthCheckId) {
      properties.HealthCheckId = healthCheckId;
    } else {
      delete properties.HealthCheckId;
    }

    const elements = resources.Outputs.RegionalEndpoint.Value['Fn::Join'][1];
    if (elements[2]) {
      elements[2] = `/${this.options.stage}`;
    }
  }

  prepareComment(distributionConfig) {
    const name = this.serverless.getProvider('aws').naming.getApiGatewayName();
    distributionConfig.Comment = `API: ${name} (${this.options.region})`;
  }

  prepareOrigins(distributionConfig) {
    const regionalDomainName = this.serverless.service.custom.dns.regionalDomainName;

    distributionConfig.Origins[0].DomainName = regionalDomainName;
    distributionConfig.Origins[0].OriginPath = `/${this.options.stage}`;
  }

  prepareHeaders(distributionConfig) {
    const headers = this.serverless.service.custom.cdn.headers;

    if (headers) {
      distributionConfig.DefaultCacheBehavior.ForwardedValues.Headers = headers;
    } else {
      distributionConfig.DefaultCacheBehavior.ForwardedValues.Headers = ['Accept', 'Authorization'];
    }
  }

  preparePriceClass(distributionConfig) {
    const priceClass = this.serverless.service.custom.cdn.priceClass;

    if (priceClass) {
      distributionConfig.PriceClass = priceClass;
    } else {
      distributionConfig.PriceClass = 'PriceClass_100';
    }
  }

  prepareAliases(distributionConfig) {
    const aliases = this.serverless.service.custom.cdn.aliases;

    if (aliases) {
      distributionConfig.Aliases = aliases;
    } else {
      delete distributionConfig.Aliases;
    }
  }

  prepareCertificate(distributionConfig) {
    const acmCertificateArn = this.serverless.service.custom.cdn.acmCertificateArn;
    if (acmCertificateArn) {
      distributionConfig.ViewerCertificate.AcmCertificateArn = acmCertificateArn;
    } else {
      delete distributionConfig.ViewerCertificate;
    }
  }

  prepareLogging(distributionConfig) {
    const logging = this.serverless.service.custom.cdn.logging;

    if (logging) {
      distributionConfig.Logging.Bucket = `${logging.bucketName}.s3.amazonaws.com`;
      distributionConfig.Logging.Prefix = logging.prefix || `aws-cloudfront/api/${this.options.stage}/${this.serverless.getProvider('aws').naming.getStackName()}`;

    } else {
      delete distributionConfig.Logging;
    }
  }

  prepareWaf(distributionConfig) {
    const webACLId = this.serverless.service.custom.cdn.webACLId;

    if (webACLId) {
      distributionConfig.WebACLId = webACLId;
    } else {
      delete distributionConfig.WebACLId;
    }
  }

  prepareApiGlobalEndpointRecord(resources) {
    const properties = resources.Resources.ApiGlobalEndpointRecord.Properties;

    const hostedZoneId = this.serverless.service.custom.dns.hostedZoneId;
    if (hostedZoneId) {
      properties.HostedZoneId = hostedZoneId;
    } else {
      delete properties.hostedZoneId;
    }

    const globalDomainName = this.serverless.service.custom.dns.domainName;
    properties.Name = `${globalDomainName}.`;

    const elements = resources.Outputs.GlobalEndpoint.Value['Fn::Join'][1];
    if (elements[1]) {
      elements[1] = globalDomainName;
    }
  }
}

module.exports = Plugin;
