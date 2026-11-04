# CINEVERSE

Catálogo colaborativo com filmes publicados online. Qualquer visitante pode enviar e excluir títulos. Os arquivos MP4 ou MKV devem ter entre 100 MB e 30 GB, com capas opcionais de até 2 MB. Filmes da antiga versão local precisam ser enviados novamente.

O formulário envia o vídeo em partes de 3 MiB, mostra o progresso e permite tentar novamente na mesma página sem reenviar partes confirmadas. O título só entra no catálogo quando todas as partes chegam ao servidor. Mantenha a página aberta durante o envio. A reprodução depende dos codecs do navegador; MP4 com H.264 e AAC oferece maior compatibilidade.

Os registros ficam no Netlify Database, com o esquema em `db/schema.ts` e as migrações em `netlify/database/migrations`. Vídeos e capas ficam no Netlify Blobs. O player lê intervalos de bytes, permitindo avançar no vídeo sem baixar o arquivo inteiro. Exclusões são limpas em segundo plano; envios abandonados por mais de 48 horas também são removidos. O armazenamento de testes de deploy fica separado de produção.

O site está em `public/`, e as APIs em `netlify/functions/`. Não é necessário configurar credenciais de armazenamento no navegador. As migrações são aplicadas pela plataforma durante o deploy.

Para desenvolvimento local, use `netlify dev --port 8889`.

Validação:

- `npm run typecheck`
- `npm test` — testes isolados do catálogo, publicação, intervalos de reprodução e limpeza, sem acessar o banco do site.
- `npx playwright install chromium`, seguido de `npm run test:browser -- /caminho/clipe-h264.mp4` — teste de envio e reprodução em duas sessões independentes, com um clipe de teste menor que 100 MB. O teste completa o tamanho com um bloco MP4 livre para exercitar o limite mínimo, sem alterar o vídeo original.
