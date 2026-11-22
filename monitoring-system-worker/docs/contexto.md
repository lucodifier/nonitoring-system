# Contexto

Sistema é um worker em node e typescript para ler dados do loki e prometheus e também comandos docker para extrair dados, gravar em base postgres, um cron para rodar de tempos em tempos para alimentar os dados:

Coleta → Calcula → Persiste → Alerta → [repete] 

Mais informações no arquivo comofunciona.md

