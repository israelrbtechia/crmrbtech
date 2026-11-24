# CRM RBTech com IA

CRM da RBTech Celulares com uma IA (Claude, da Anthropic) que atende clientes, vende iPhones pelo catálogo, marca compromissos e aprende o jeito do dono de escrever. É um app de um arquivo só (`index.html`), sem servidor e sem build.

## O que tem

- **Conversas:** a IA atende o cliente em três modos por conversa: responde sozinha, sugere e você envia, ou só você responde.
- **Funil em cards:** a IA move o cliente entre as fases e atualiza temperatura (quente, morno, frio), valor do negócio, próximo passo e um resumo, conforme a conversa anda.
- **Follow-up:** quando o cliente para de responder, a IA manda uma mensagem para retomar a conversa, nos dias que você escolher (ex.: 1, 3 e 7 dias), só no horário permitido. Sem resposta depois da última tentativa, o cartão vai para Perdido; se o cliente voltar a falar, volta sozinho para o funil.
- **Aprovação antes de vender:** antes de fechar qualquer venda, a IA pergunta ao dono se tem em estoque e se o valor está certo.
- **Agenda:** retiradas, entregas de iPhone, orçamentos e reparos, com Google Agenda opcional.
- **Catálogo de iPhones** e **aprendizado do estilo do dono** a partir de conversas exportadas do WhatsApp.
- **Marca personalizável** (nome, logo, cor) e pacote de configuração para revender a outras lojas.

## Publicar na Vercel

1. Em [vercel.com](https://vercel.com) > **Add New > Project**, importe este repositório.
2. Em **Framework Preset**, escolha **Other**. Não precisa de comando de build nem de variáveis de ambiente.
3. Clique em **Deploy**. O app fica em `https://SEU-PROJETO.vercel.app`.

Cada novo push na branch `main` publica de novo sozinho.

## Primeiro uso

1. Abra o endereço da Vercel no navegador do computador da loja.
2. **Configurações > Inteligência artificial:** cole a chave da API da Anthropic (console.anthropic.com).
3. **Catálogo:** preencha os preços.
4. **Painel > Simular cliente no WhatsApp** para ver a IA atender.

## Importante

- **Os dados ficam no navegador de quem usa** (clientes, conversas, catálogo e a chave da Anthropic). Nada vai para a Vercel nem para o GitHub. Por isso, o computador e o celular têm dados separados. Use **Configurações > Baixar backup** com frequência.
- **Ninguém mais vê os seus dados:** quem abrir o mesmo endereço vê um app vazio, no navegador dele.
- **Os follow-ups saem enquanto o app estiver aberto** em algum navegador.
- **WhatsApp:** por enquanto é um simulador. Para a IA atender o WhatsApp de verdade, é preciso um servidor que receba as mensagens (próxima fase). No WhatsApp oficial, depois de 24 horas sem o cliente falar, só é possível mandar mensagens com modelo aprovado pela Meta, o que vale para os follow-ups.
- **Google Agenda:** no Google Cloud, cadastre o endereço da Vercel (ex.: `https://SEU-PROJETO.vercel.app`) em **Origens JavaScript autorizadas** do Client ID. O passo a passo está em Configurações > Google Agenda.
