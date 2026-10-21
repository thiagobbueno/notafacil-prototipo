# NotaFácil

Aplicativo para o escritório contábil emitir NFS-e de clientes em Goiás em poucos toques, com um atalho por voz. A interface é em português (pt-BR) e pensada para o celular.

O arquivo `index.html` na raiz continua sendo o **protótipo clicável** publicado no GitHub Pages. Ele não emite nota. O aplicativo de verdade está na pasta `notafacil/`. A pasta `app/` é uma cópia estática só para demonstração no celular.

## O que o aplicativo faz

- Login do contador e várias empresas (CNPJs) no mesmo escritório.
- Cadastro de tomadores e de serviços (item da LC 116, código nacional, código municipal e alíquota de ISS).
- Emissão, consulta, PDF, XML e cancelamento.
- Atalho por voz: a frase vira um rascunho e a nota **só sai depois da confirmação**.
- Sem `FOCUS_NFE_TOKEN`, entra em **modo demonstração**: nada é enviado à Focus nem à prefeitura.

## Dois caminhos de emissão (somente Goiás, somente homologação)

A emissão deste MVP está travada no host `homologacao.focusnfe.com.br`. O código recusa mandar NFS-e para `api.focusnfe.com.br`.

| Quem emite | Caminho | Como a Focus trata |
| --- | --- | --- |
| MEI ou Simples Nacional, em qualquer município de GO | Emissor Nacional | `POST /v2/nfsen` com a empresa em `habilita_nfsen_homologacao`. Não ligar a NFS-e municipal. |
| Lucro presumido ou real em Aparecida de Goiânia (IBGE 5201405) | Emissor Nacional | O município passa a exigir o Portal Nacional para todos os contribuintes em 01/11/2026. |
| Lucro presumido ou real em Goiânia (IBGE 5208707) | ISSNet / SGISS | O [guia atual da Focus para Goiânia](https://focusnfe.com.br/guides/nfse/municipios-integrados/goiania-go/) manda usar o layout nacional no `POST /v2/nfsen` **sem** ligar o “Ambiente da NFS-e Nacional”. O provedor é o IssNet; o XML segue para o SGISS. O código tributário municipal do serviço é obrigatório. |
| Lucro presumido ou real em outra cidade | Fora do escopo | O aplicativo recusa, em vez de chutar a prefeitura. |

O guia antigo da Focus para Goiânia (`/v2/nfse`, ABRASF) está marcado como descontinuado. Por isso o caminho municipal também usa `/v2/nfsen`, mas com outro payload e com a flag da empresa diferente: `habilita_nfse` ligada e `habilita_nfsen_homologacao` desligada.

`codigo_opcao_simples_nacional` segue o leiaute nacional da DPS (`opSimpNac`): **1** não optante, **2** MEI, **3** ME/EPP do Simples Nacional.

### O que a legislação diz sobre a data

A Resolução CGSN nº 189/2026 previa o Emissor Nacional para o Simples em **01/09/2026**. A [Resolução CGSN nº 191/2026](https://www.gov.br/receitafederal/pt-br/assuntos/noticias/2026/agosto/simples-nacional-nfs-e-nacional-sera-obrigatoria-para-me-e-epp-a-partir-de-1o-de-novembro-de-2026) revogou essa data e passou a obrigação das ME e EPP para **01/11/2026**. O MEI já emite NFS-e nacional de serviços. O aplicativo já roteia MEI e Simples Nacional para o Emissor Nacional.

## Como rodar na máquina

É preciso Node.js 22.5 ou mais novo (o banco usa o `node:sqlite` que vem com o Node).

```bash
cd notafacil
cp .env.example .env
npm install
npm test
npm run dev
```

Abra http://localhost:3000

Conta de demonstração, criada sozinha no primeiro início:

- e-mail: `contador@notafacil.local`
- senha: `notafacil`

O escritório de exemplo já traz três empresas:

- Limpeza Fácil Serviços ME — Simples Nacional, Anápolis — Emissor Nacional
- Alfa Engenharia Ltda — lucro presumido, Goiânia — ISSNet/SGISS
- João Reparos MEI — Aparecida de Goiânia — Emissor Nacional

Para falar uma nota de teste, toque em **Falar nota** e em **Simular áudio**, ou diga: “nota de 1500 reais para Construtora X, limpeza pós-obra”. Revise a tela de confirmação e só então emita.

### Demonstração no celular (GitHub Pages)

Não precisa de servidor nem de token da Focus. A versão em `app/` guarda empresas, tomadores e notas no `localStorage` do aparelho. Nada sai para a Focus.

https://thiagobbueno.github.io/notafacil-prototipo/app/

O mesmo login de demonstração vale: `contador@notafacil.local` / `notafacil`.

O protótipo clicável continua na raiz do site: https://thiagobbueno.github.io/notafacil-prototipo/

Para gerar de novo a pasta `app/` (o GitHub Pages publica o que está no branch `main`):

```bash
cd notafacil
npm run build:pages
```

### Token de homologação

No [painel da Focus](https://focusnfe.com.br), copie o **token de homologação** (não o de produção) e coloque em `notafacil/.env`:

```bash
FOCUS_NFE_TOKEN=cole_o_token_de_homologacao
```

Reinicie o `npm run dev`. A faixa do topo passa de “demonstração” para “homologação”. A nota de teste continua sem valor fiscal, mas a Focus passa a processá-la de verdade no ambiente de homologação. Cada empresa precisa de certificado A1 válido cadastrado na Focus, senão a prefeitura recusa.

O arquivo `.env` não entra no git.

## Certificado A1

A NotaFácil não grava o `.pfx` nem a senha.

1. No cadastro da empresa, envie o arquivo só se `FOCUS_NFE_TOKEN_PRINCIPAL` estiver definido. Esse token é o **token principal de produção**, porque a [API de empresas](https://doc.focusnfe.com.br/reference/criar_empresa) só existe em `api.focusnfe.com.br`. Sem `FOCUS_EMPRESAS_EFETIVAR=1` o envio é `dry_run=1`: a Focus valida e não grava.
2. Sem o token principal, cadastre o certificado no painel (Empresas → certificado A1) e, no aplicativo, marque **Já cadastrei no painel da Focus**.
3. Para Simples, MEI e Aparecida, ligue só “Ambiente da NFS-e Nacional — Homologação”.
4. Para lucro presumido ou real em Goiânia, ligue a NFS-e municipal e deixe o Ambiente Nacional desligado.

## Deploy barato

O aplicativo é um processo Node com SQLite em disco. Não serve para função sem servidor (o arquivo do banco precisa persistir e a consulta da nota fica aberta por alguns segundos).

Uma máquina pequena (ou o plano gratuito de um provedor com disco persistente) chega:

```bash
cd notafacil
npm install
npm run build
npm start
```

`npm start` sobe a API e os arquivos estáticos de `dist/client` na porta `PORT` (padrão 3000). Coloque um proxy com HTTPS na frente. O webhook da Focus precisa dessa URL pública:

`POST https://seu-dominio/api/webhooks/focus`

Defina `FOCUS_WEBHOOK_SECRET` e cadastre o mesmo valor no gatilho `nfsen` (e `nfse`, se a Focus separar o evento municipal) da empresa. O header `Authorization` tem de ser esse segredo. Sem o segredo o endpoint recusa a chamada. A tela da nota também consulta a Focus enquanto o status está “Processando”, então o webhook é um reforço, não a única via.

Em produção fechada, use `NOTAFACIL_REGISTRO=fechado` para ninguém criar outra conta. Troque a senha do usuário de demonstração.

O GitHub Pages publica o `index.html` da raiz (protótipo) e a pasta `app/` (demonstração sem servidor). A emissão de verdade continua precisando do processo Node.

## Para valer de verdade (produção)

Este repositório **não emite em produção**. Quando for a hora, além de tirar o travamento de homologação no código:

1. Token de **produção** da Focus, separado do de homologação, e certificado A1 de cada CNPJ dentro da validade.
2. Ligar `habilita_nfsen_producao` só nas empresas do Emissor Nacional. A Focus não aceita essa flag junto com `habilita_nfse`.
3. Em Goiânia, para lucro presumido ou real, pedir a liberação do webservice de produção e do lote de RPS no portal da prefeitura. A Focus publica o contato do provedor `suporte@notaeletronica.com.br`. O FAQ do SGISS também cita `suporte.goiania@notacontrol.com.br`. O canal indicado para a prefeitura neste projeto é `suporte.nfse@goiania.go.gov.br`.
4. Conferir com o contador, antes de produção, o código tributário municipal, a NBS e a classificação de IBS/CBS. O guia da Focus para Goiânia mostra esses campos no exemplo da reforma; o MVP só envia NBS e código municipal quando estão preenchidos no serviço. O ISS da tela é estimativa do cadastro — a prefeitura é quem calcula o valor oficial.
5. Aparecida de Goiânia: a Focus ainda marca a homologação municipal como indisponível e descreve IssNet. A prefeitura anunciou o Portal Nacional para todos os contribuintes a partir de 01/11/2026. Vale confirmar com o município na virada.
6. Backup do arquivo `notafacil/data/notafacil.sqlite`.

## Testes

```bash
cd notafacil
npm test
```

Cobrem o payload dos dois caminhos (Emissor Nacional e ISSNet/SGISS de Goiânia), o texto falado e o fluxo de demonstração: login, emissão, PDF, XML, cancelamento e webhook.
