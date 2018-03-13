const path = require('path');
const _ = require('lodash');
const chalk = require('chalk');
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
    const regionalDomainName = this.serverless.service.custom.regionalEndpoints.domainName;
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

    const globalDomainName = this.serverless.service.custom.globalEndpoint.domainName;
    const cloudFrontRegion = this.serverless.service.custom.globalEndpoint.region;
    if (!globalDomainName || cloudFrontRegion !== this.options.region) {
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

    const regionalDomainName = this.serverless.service.custom.regionalEndpoints.domainName;
    properties.DomainName = regionalDomainName;

    const acmCertificateArn = this.serverless.service.custom.regionalEndpoints[this.options.region].acmCertificateArn;
    if (acmCertificateArn) {
      properties.RegionalCertificateArn = acmCertificateArn;
    } else {
      delete properties.RegionalCertificateArn;
    }    
  }

  prepareApiRegionalEndpointRecord(resources) {
    const targetDomainName = this.serverless.service.custom.regionalEndpoints[this.options.region].targetDomainName;
    if (!targetDomainName) {
      delete resources.Resources.ApiRegionalEndpointRecord;
      delete resources.Outputs.RegionalEndpoint;
      return;
    }

    const properties = resources.Resources.ApiRegionalEndpointRecord.Properties;

    const hostedZoneId = this.serverless.service.custom.regionalEndpoints.hostedZoneId;
    if (hostedZoneId) {
      properties.HostedZoneId = hostedZoneId;

    } else {
      delete properties.hostedZoneId;
    }

    properties.Region = this.options.region;
    properties.SetIdentifier = this.options.region;
    
    const healthCheckId = this.serverless.service.custom.regionalEndpoints[this.options.region].healthCheckId;
    if (healthCheckId) {
      properties.HealthCheckId = healthCheckId;
    } else {
      delete properties.HealthCheckId;
    }

    const aliasTarget = properties.AliasTarget;

    const regionalHostedZoneId = this.serverless.service.custom.regionalEndpoints[this.options.region].hostedZoneId;
    if (regionalHostedZoneId) {
      aliasTarget.HostedZoneId = regionalHostedZoneId;
    } else {
      delete aliasTarget.HostedZoneId;
    }    

    if (targetDomainName) {
      aliasTarget.DNSName = targetDomainName;
    } else {
      delete aliasTarget.DNSName;
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
    const regionalDomainName = this.serverless.service.custom.regionalEndpoints.domainName;

    distributionConfig.Origins[0].DomainName = regionalDomainName;
    distributionConfig.Origins[0].OriginPath = `/${this.options.stage}`;
  }

  prepareHeaders(distributionConfig) {
    const headers = this.serverless.service.custom.globalEndpoint.headers;

    if (headers) {
      distributionConfig.DefaultCacheBehavior.ForwardedValues.Headers = headers;
    } else {
      distributionConfig.DefaultCacheBehavior.ForwardedValues.Headers = ['Accept', 'Authorization'];
    }
  }

  preparePriceClass(distributionConfig) {
    const priceClass = this.serverless.service.custom.globalEndpoint.priceClass;

    if (priceClass) {
      distributionConfig.PriceClass = priceClass;
    } else {
      distributionConfig.PriceClass = 'PriceClass_All';
    }
  }

  prepareAliases(distributionConfig) {
    const aliases = this.serverless.service.custom.globalEndpoint.aliases;

    if (aliases) {
      distributionConfig.Aliases = aliases;
    } else {
      delete distributionConfig.Aliases;
    }
  }

  prepareCertificate(distributionConfig) {
    const acmCertificateArn = this.serverless.service.custom.globalEndpoint.acmCertificateArn;
    if (acmCertificateArn) {
      distributionConfig.ViewerCertificate.AcmCertificateArn = acmCertificateArn;
    } else {
      delete distributionConfig.ViewerCertificate;
    }    
  }

  prepareLogging(distributionConfig) {
    const logging = this.serverless.service.custom.globalEndpoint.logging;

    if (logging) {
      distributionConfig.Logging.Bucket = logging.bucket;
      distributionConfig.Logging.Prefix = logging.prefix;
    } else {
      delete distributionConfig.Logging;
    }
  }

  prepareWaf(distributionConfig) {
    const WebACLId = this.serverless.service.custom.globalEndpoint.WebACLId;

    if (WebACLId) {
      distributionConfig.WebACLId = WebACLId;
    } else {
      delete distributionConfig.WebACLId;
    }
  }

  prepareApiGlobalEndpointRecord(resources) {
    const properties = resources.Resources.ApiGlobalEndpointRecord.Properties;

    const hostedZoneId = this.serverless.service.custom.globalEndpoint.hostedZoneId;
    if (hostedZoneId) {
      properties.HostedZoneId = hostedZoneId;
    } else {
      delete properties.hostedZoneId;
    }

    const globalDomainName = this.serverless.service.custom.globalEndpoint.domainName;
    properties.Name = `${globalDomainName}.`;

    const elements = resources.Outputs.GlobalEndpoint.Value['Fn::Join'][1];
    if (elements[1]) {
      elements[1] = globalDomainName;
    }    
  }  
}

module.exports = Plugin;
