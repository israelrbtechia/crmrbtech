# CRM RBTech com IA

CRM da RBTech Celulares com uma IA (Claude, da Anthropic) que atende clientes, vende iPhones pelo catálogo, marca compromissos e aprende o jeito do dono de escrever. É um app de um arquivo só (`index.html`), sem servidor e sem build.

## O que tem

- **Conversas:** a IA atende o cliente em três modos por conversa: responde sozinha, sugere e você envia, ou só você responde.
- **Funil em cards:** a IA move o cliente entre as fases e atualiza temperatura (quente, morno, frio), valor do negócio, próximo passo e um resumo, conforme a conversa anda.
- **Follow-up:** quando o cliente para de responder, a IA manda uma mensagem para retomar a conversa, nos dias que você escolher (ex.: 1, 3 e 7 dias), só no horário permitido. Sem resposta depois da última tentativa, o cartão vai para Perdido; se o cliente voltar a falar, volta sozinho para o funil.
- **Aprovação antes de vender:** antes de fechar qualquer venda, a IA pergunta ao dono se tem em estoque e se o valor está certo.
- **Agenda:** retiradas, entregas de iPhone, orçamentos e reparos, com Google Agenda opcional.
- **Dados do site da loja:** o CRM importa tudo do site (repositório `rb-tech-celulares`, arquivo `data/catalogo.json`): aparelhos com preço, foto, cor, bateria e garantia, taxas de cada parcela do cartão (até 24x), tabela de troca do usado, cupons, campanhas, políticas, benefícios e reparos. A IA calcula parcelas e avaliação do usado com as mesmas contas do site, e se atualiza sozinha quando o admin do site publica uma mudança.
- **Aprendizado do estilo do dono** a partir de conversas exportadas do WhatsApp.
- **Marca personalizável** (nome, logo, cor) e pacote de configuração para revender a outras lojas.

## Custo da IA

O modelo padrão é o **Claude Haiku 5.5**, o mais barato: para 20 a 25 clientes por dia, fica em torno de **US$ 5 a 10 por mês**. Em Configurações > Inteligência artificial dá para trocar pelo Sonnet 5.5 (cerca de US$ 100 a 175 por mês) ou pelo Opus 5.5 (cerca de US$ 200 a 350 por mês), que negociam melhor. O Painel mostra o gasto estimado do mês.

## Publicar na Vercel

1. Em [vercel.com](https://vercel.com) > **Add New > Project**, importe este repositório.
2. Em **Framework Preset**, escolha **Other**. Não precisa de comando de build.
3. Em **Settings > Environment Variables**, cadastre (para Production, Preview e Development):

| Variável | O que é | Obrigatória |
|---|---|---|
| `ANTHROPIC_API_KEY` | Chave da API da Anthropic (console.anthropic.com > API Keys). Marque como **Sensitive**. Fica só no servidor. | sim |
| `SUPABASE_URL` | Project URL do Supabase (`https://xxxx.supabase.co`) | sim |
| `SUPABASE_PUBLISHABLE_KEY` | Chave *publishable* (ou *anon public*) do Supabase | sim |
| `GOOGLE_CLIENT_ID` | Client ID do Google Agenda | não |
| `CRM_EMAILS` | E-mails que podem usar o CRM, separados por vírgula. Vazio = qualquer usuário criado no Supabase | não |

4. Clique em **Deploy** (ou, se o projeto já existia, **Deployments > ⋯ > Redeploy**, porque variável nova só vale depois de publicar de novo).

Com as variáveis, o CRM abre numa tela de login e não mostra mais campos de chave nem de conexão: a IA, o Supabase e o Google já vêm ligados. O navegador nunca recebe a chave da Anthropic. A IA passa por `api/anthropic.js`, que só atende quem está logado.

Cada novo push na branch `main` publica de novo sozinho.

## Primeiro uso

1. Abra o endereço da Vercel no navegador do computador da loja.
2. **Configurações > Inteligência artificial:** cole a chave da API da Anthropic (console.anthropic.com).
3. **Catálogo:** preencha os preços.
4. **Painel > Simular cliente no WhatsApp** para ver a IA atender.

## Salvar na nuvem (Supabase)

Sem o Supabase, os dados ficam só no navegador. Com ele, clientes, conversas, funil, aprovações, agenda, catálogo, configurações e o estilo de escrita ficam salvos na nuvem e aparecem no computador e no celular.

1. No [Supabase](https://supabase.com) (pode ser o mesmo projeto do site), abra **SQL Editor**, cole [`supabase/crm.sql`](supabase/crm.sql) e clique em **Run**.
2. Em **Authentication > Users > Add user**, crie o acesso do dono (e-mail e senha, com *Auto Confirm User*).
3. Em **Authentication > Sign In / Providers**, desligue **Allow new users to sign up**.
4. Coloque a Project URL e a chave nas variáveis da Vercel (acima) e entre no CRM com o e-mail e a senha.

Só o usuário logado lê e grava os dados (RLS).

## Importante

- **Sem o Supabase, os dados ficam no navegador de quem usa.** O computador e o celular têm dados separados. Use **Configurações > Baixar backup** com frequência.
- **Ninguém mais vê os seus dados:** quem abrir o mesmo endereço sem o seu login vê um app vazio.
- **Os follow-ups saem enquanto o app estiver aberto** em algum navegador.
- **WhatsApp:** por enquanto é um simulador. Para a IA atender o WhatsApp de verdade, é preciso um servidor que receba as mensagens (próxima fase). No WhatsApp oficial, depois de 24 horas sem o cliente falar, só é possível mandar mensagens com modelo aprovado pela Meta, o que vale para os follow-ups.
- **Google Agenda:** no Google Cloud, cadastre o endereço da Vercel (ex.: `https://SEU-PROJETO.vercel.app`) em **Origens JavaScript autorizadas** do Client ID. O passo a passo está em Configurações > Google Agenda.
