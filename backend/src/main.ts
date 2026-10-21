import { createApp } from './app';
createApp()
  .then((app) => app.listen(Number(process.env.PORT ?? 3000), '0.0.0.0'))
  .catch(() => {
    console.error(
      'Não foi possível iniciar. Confira configuração e migrações.',
    );
    process.exitCode = 1;
  });
