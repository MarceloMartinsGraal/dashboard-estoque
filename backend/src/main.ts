import { ConfigurationError } from './config';
import { logProcessFailure } from './diagnostics';
import { createApp } from './app';
createApp()
  .then((app) => app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0'))
  .catch((error) => {
    logProcessFailure(
      'startup',
      error,
      ['DATABASE_URL', 'SESSION_SECRET', 'PUBLIC_ORIGIN'].filter(
        (key) => !process.env[key],
      ),
    );
    console.error(
      error instanceof ConfigurationError ? error.message : 'Não foi possível iniciar. Confira configuração e migrações.',
    );
    process.exitCode = 1;
  });
