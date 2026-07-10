import { trace, SpanStatusCode, type Span } from "@opentelemetry/api";
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node";
import { BatchSpanProcessor, ConsoleSpanExporter, SimpleSpanProcessor, type SpanExporter } from "@opentelemetry/sdk-trace-base";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";

const SERVICE_NAME = "adgo-api";

/**
 * Manual span-based tracing, not auto-instrumentation — this codebase's ESM (NodeNext)
 * setup makes auto-instrumentation's typical `--require`-a-bootstrap-file-before-your-code
 * pattern awkward to get right, and hand-placed spans around the parts of the system that
 * actually matter for debugging (research providers, AI agents, the campaign-generation
 * pipeline's phases) are more informative than generic HTTP auto-instrumentation would be
 * for this specific system anyway. Exports to the console by default (so tracing is
 * visibly working with zero setup) or to a real OTLP collector (Jaeger, Tempo, Honeycomb,
 * ...) when OTEL_EXPORTER_OTLP_ENDPOINT is set.
 */
const otlpEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
const exporter: SpanExporter = otlpEndpoint ? new OTLPTraceExporter({ url: otlpEndpoint }) : new ConsoleSpanExporter();

const provider = new NodeTracerProvider({
  resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: SERVICE_NAME }),
  spanProcessors: [otlpEndpoint ? new BatchSpanProcessor(exporter) : new SimpleSpanProcessor(exporter)],
});
provider.register();

const tracer = trace.getTracer(SERVICE_NAME);

/**
 * Runs `fn` inside a new span named `name`, recording success/failure and always ending
 * the span. This is the one seam every traced call site (providers, agents, campaign
 * generation phases) goes through, so span lifecycle/error-recording logic lives in
 * exactly one place rather than being reimplemented at each call site.
 */
export async function withSpan<T>(
  name: string,
  fn: (span: Span) => Promise<T>,
  attributes?: Record<string, string | number | boolean>
): Promise<T> {
  return tracer.startActiveSpan(name, async (span) => {
    if (attributes) span.setAttributes(attributes);
    try {
      const result = await fn(span);
      span.setStatus({ code: SpanStatusCode.OK });
      return result;
    } catch (err) {
      span.recordException(err instanceof Error ? err : new Error(String(err)));
      span.setStatus({ code: SpanStatusCode.ERROR, message: err instanceof Error ? err.message : String(err) });
      throw err;
    } finally {
      span.end();
    }
  });
}

export async function shutdownTelemetry(): Promise<void> {
  await provider.shutdown();
}
