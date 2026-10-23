import { CfnOutput, Duration, Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import type { Construct } from 'constructs';

export interface ScannerRelayStackProps extends StackProps {
  // The app the scanners' punches go to, e.g. hr.figbloom.org (its /iclock/* receiver)
  appHost: string;
}

// Header the relay adds to every request it forwards. The app trusts the scanner's IP from CloudFront only when this
// matches its ICLOCK_RELAY_SECRET (iclock routes), so nobody can fake an office IP by calling the app directly.
export const RELAY_HEADER = 'x-figbloom-relay';

// Biometric door scanners (ZKTeco push / ADMS) on office networks send punches to the app. Older firmware can only
// speak plain HTTP, and the app only takes HTTPS, so this relay accepts HTTP (and HTTPS) from scanners and forwards it
// over HTTPS. It only passes /iclock/* (the scanner protocol); anything else gets a 404 at the edge. Nothing is cached.
export class ScannerRelayStack extends Stack {
  constructor(scope: Construct, id: string, props: ScannerRelayStackProps) {
    super(scope, id, props);
    Tags.of(this).add('Component', 'scanner-relay');

    // The shared secret. Its value never leaves AWS except to CloudFront's origin header; copy it into the app's
    // ICLOCK_RELAY_SECRET from the Secrets Manager console.
    const secret = new secretsmanager.Secret(this, 'RelaySecret', {
      secretName: 'figbloom/scanner-relay/header-secret',
      description: 'Shared secret the scanner relay sends to the app in the x-figbloom-relay header',
      generateSecretString: { passwordLength: 48, excludePunctuation: true, includeSpace: false },
    });

    // Only the scanner protocol gets through
    const onlyScanners = new cloudfront.Function(this, 'OnlyScannerPaths', {
      comment: 'Scanner relay - pass /iclock/ only',
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      code: cloudfront.FunctionCode.fromInline(
        [
          'function handler(event) {',
          '  var uri = event.request.uri;',
          "  if (uri.indexOf('/iclock/') === 0) return event.request;",
          "  return { statusCode: 404, statusDescription: 'Not Found' };",
          '}',
        ].join('\n'),
      ),
    });

    // The scanner's query string (SN, table, Stamp), its content type and its real IP go to the app; not its Host
    const forward = new cloudfront.OriginRequestPolicy(this, 'ScannerRequests', {
      comment: 'Scanner relay - query string, content type and viewer address',
      queryStringBehavior: cloudfront.OriginRequestQueryStringBehavior.all(),
      headerBehavior: cloudfront.OriginRequestHeaderBehavior.allowList('Content-Type', 'User-Agent', 'CloudFront-Viewer-Address'),
      cookieBehavior: cloudfront.OriginRequestCookieBehavior.none(),
    });

    const distribution = new cloudfront.Distribution(this, 'Relay', {
      comment: 'Figbloom scanner relay - HTTP from door scanners to the app over HTTPS',
      // edges near the offices (Nairobi, Johannesburg) are only in the full price class; the traffic is tiny
      priceClass: cloudfront.PriceClass.PRICE_CLASS_ALL,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      enableIpv6: true,
      defaultBehavior: {
        origin: new origins.HttpOrigin(props.appHost, {
          protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
          originSslProtocols: [cloudfront.OriginSslPolicy.TLS_V1_2],
          readTimeout: Duration.seconds(30),
          customHeaders: { [RELAY_HEADER]: secret.secretValue.unsafeUnwrap() },
        }),
        // old firmware can't follow a redirect to HTTPS, so plain HTTP is served as is
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.ALLOW_ALL,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
        cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
        originRequestPolicy: forward,
        compress: false,
        functionAssociations: [{ function: onlyScanners, eventType: cloudfront.FunctionEventType.VIEWER_REQUEST }],
      },
    });

    new CfnOutput(this, 'ScannerServerAddress', {
      value: distribution.distributionDomainName,
      description: 'Enter this as the Server address on the scanner (Enable domain name ON, port 80)',
    });
    new CfnOutput(this, 'RelaySecretName', {
      value: secret.secretName,
      description: 'Copy this secret value into the app as ICLOCK_RELAY_SECRET',
    });
  }
}
