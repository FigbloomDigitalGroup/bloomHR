import { Stack, Tags, type StackProps } from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import type { Construct } from 'constructs';
import type { EnvironmentName } from './config.js';

export interface EnvironmentStackProps extends StackProps {
  environmentName: EnvironmentName;
}

// One copy per environment (staging, production). Later stages add self-hosted Supabase, the website and the API here,
// so the same code builds both and staging is a faithful rehearsal of production.
export class EnvironmentStack extends Stack {
  constructor(scope: Construct, id: string, props: EnvironmentStackProps) {
    super(scope, id, {
      ...props,
      // Production can't be deleted with a stray `cdk destroy`; protection has to be turned off by hand first
      terminationProtection: props.environmentName === 'production',
    });

    Tags.of(this).add('Environment', props.environmentName);

    // A stack needs at least one resource; this also lets scripts check which environment they're pointed at
    new ssm.StringParameter(this, 'EnvironmentName', {
      parameterName: `/figbloom/${props.environmentName}/environment`,
      stringValue: props.environmentName,
      description: 'Which Figbloom environment this is',
    });
  }
}
