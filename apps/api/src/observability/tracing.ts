import { SpanKind, SpanStatusCode, trace, type Attributes, type Span } from '@opentelemetry/api';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { BatchSpanProcessor, NodeTracerProvider } from '@opentelemetry/sdk-trace-node';

/**
 * OpenTelemetry tracing (M1-OPS-01). OFF by default: without `OTEL_EXPORTER_OTLP_ENDPOINT` no SDK is
 * registered and every span below is a no-op from `@opentelemetry/api` (pg-boss emits its own spans
 * and honours the same global provider).
 *
 * `tenant_id` is a SPAN attribute (and a log field), never a metric label (metrics.ts).
 */
let provider: NodeTracerProvider | undefined;

export interface TracingOptions {
  /** OTLP/HTTP base URL, e.g. `http://otel-collector:4318`. Tracing stays off when absent. */
  endpoint?: string;
  serviceName: string;
  role: string;
}

/** Registers the SDK when an endpoint is configured. Returns whether tracing is on. */
export function initTracing(options: TracingOptions): boolean {
  if (provider || !options.endpoint) return provider !== undefined;
  process.env.OTEL_SERVICE_NAME ??= `${options.serviceName}-${options.role}`;
  provider = new NodeTracerProvider({
    spanProcessors: [
      new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${options.endpoint.replace(/\/+$/, '')}/v1/traces` }),
      ),
    ],
  });
  provider.register();
  return true;
}

/** Flushes pending spans (graceful shutdown). */
export async function shutdownTracing(): Promise<void> {
  const current = provider;
  provider = undefined;
  await current?.shutdown().catch(() => undefined);
}

const tracer = () => trace.getTracer('assettracker-api');

/** Runs `fn` inside a span; records the exception and marks the span failed when `fn` throws. */
export async function withSpan<T>(
  name: string,
  attributes: Attributes,
  fn: (span: Span) => Promise<T>,
  kind: SpanKind = SpanKind.INTERNAL,
): Promise<T> {
  return tracer().startActiveSpan(name, { kind, attributes }, async (span) => {
    try {
      return await fn(span);
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR });
      throw err;
    } finally {
      span.end();
    }
  });
}

/** Starts a span that the caller ends (HTTP request spans, whose end is in a different hook). */
export function startSpan(
  name: string,
  attributes: Attributes,
  kind: SpanKind = SpanKind.SERVER,
): Span {
  return tracer().startSpan(name, { kind, attributes });
}

export { SpanKind, SpanStatusCode };
