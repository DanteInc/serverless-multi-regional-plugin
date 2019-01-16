# serverless-multi-regional-plugin

This plugin will add the resources to configure API Gateway regional endpoints and a global endpoint with CloudFront.

<img src="multi-regional-api.png" width="700">

1. Install plugin:

```
npm install serverless-multi-regional-plugin --save-dev
```

2. Create your hosted zone and certificates

> Using the diagram above as an example the hosted zone would be for _example.com_ and the certificate would be for _*.example.com_. Create the same certificate in each region to support the regional endpoints. The global endpoint requires a certificate in the us-east-1 region.

3. serverless.yml:

```
plugins:
  - serverless-multi-regional-plugin

custom:
  dns:
    domainName: ${self:service}.example.com
    regionalDomainName: ${self:custom.dns.domainName}-${opt:region}
    us-east-1:
      acmCertificateArn: arn:aws:acm:us-east-1:870671212434:certificate/55555555-5555-5555-5555-5555555555555555
      # healthCheckId: 44444444-4444-4444-4444-444444444444
    us-west-2:
      acmCertificateArn: arn:aws:acm:us-west-2:111111111111:certificate/55555555-5555-5555-5555-5555555555555555
      # healthCheckId: 33333333-3333-3333-3333-333333333333
  cdn:
    region: us-east-1
    aliases:
      - ${self:custom.dns.domainName}
    # headers:
    priceClass: PriceClass_100
    acmCertificateArn: ${self:custom.dns.us-east-1.acmCertificateArn}
    logging:
      bucket: example-auditing.s3.amazonaws.com
      prefix: aws-cloudfront/api/${opt:stage}/${self:service}
    # webACLId:
```

* If an acmCertificateArn is not supplied, it will be derived from the domain name if one exists.
* If a healthCheckId is not supplied, a minimal healthcheck will be created automatically

4. Deploy to each region


## Related Documentation
* [Building a Multi-region Serverless Application with Amazon API Gateway and AWS Lambda](https://aws.amazon.com/blogs/compute/building-a-multi-region-serverless-application-with-amazon-api-gateway-and-aws-lambda)
