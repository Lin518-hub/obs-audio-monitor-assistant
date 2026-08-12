import { X509Certificate } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';

const DAY_MS = 24 * 60 * 60 * 1000;

export function certificateStatus(certificate, now = Date.now()) {
  const parsed = new X509Certificate(certificate);
  const validTo = Date.parse(parsed.validTo);
  return {
    subject: parsed.subject,
    validTo,
    daysRemaining: Number.isFinite(validTo) ? Math.ceil((validTo - now) / DAY_MS) : null
  };
}

export function createTlsCertificateReloader({
  server,
  certFile,
  keyFile,
  intervalMs = 5 * 60 * 1000,
  logger = console
}) {
  let lastSignature = null;
  let timer = null;
  let running = null;

  const inspectCertificate = (certificate) => {
    try {
      const status = certificateStatus(certificate);
      const detail = status.daysRemaining == null ? '' : `, ${status.daysRemaining} days remaining`;
      const writer = status.daysRemaining != null && status.daysRemaining <= 30 ? logger.warn : logger.log;
      writer?.call(logger, `[tls] certificate expires ${new Date(status.validTo).toISOString()}${detail}`);
    } catch (error) {
      logger.warn?.(`[tls] unable to inspect certificate: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const fileSignature = async () => {
    const [certificate, key] = await Promise.all([stat(certFile), stat(keyFile)]);
    return `${certificate.mtimeMs}:${certificate.size}:${key.mtimeMs}:${key.size}`;
  };

  const initialize = async () => {
    const [signature, certificate] = await Promise.all([fileSignature(), readFile(certFile)]);
    lastSignature = signature;
    inspectCertificate(certificate);
  };

  const checkNow = async () => {
    const signature = await fileSignature();
    if (signature === lastSignature) return false;
    const [certificate, key] = await Promise.all([readFile(certFile), readFile(keyFile)]);
    server.setSecureContext({ cert: certificate, key });
    lastSignature = signature;
    inspectCertificate(certificate);
    logger.log?.('[tls] reloaded updated certificate files');
    return true;
  };

  const guardedCheck = () => {
    if (!running) {
      running = checkNow()
        .catch((error) => {
          logger.error?.(`[tls] certificate reload failed; keeping the current certificate: ${error instanceof Error ? error.message : String(error)}`);
          return false;
        })
        .finally(() => {
          running = null;
        });
    }
    return running;
  };

  return {
    initialize,
    checkNow: guardedCheck,
    start() {
      if (timer) return;
      timer = setInterval(() => void guardedCheck(), Math.max(60_000, Number(intervalMs) || 5 * 60 * 1000));
      timer.unref?.();
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = null;
    }
  };
}
