# 🏆 Sistema Bot Leilão Telegram (bot-leilao-telegram)

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-43853D?style=for-the-badge&logo=node.js&logoColor=white" alt="Node.js">
  <img src="https://img.shields.io/badge/MySQL-005C84?style=for-the-badge&logo=mysql&logoColor=white" alt="MySQL">
  <img src="https://img.shields.io/badge/Telegram-2CA5E0?style=for-the-badge&logo=telegram&logoColor=white" alt="Telegram">
  <img src="https://img.shields.io/github/license/danielambrosim/sbl?color=blue&style=for-the-badge" alt="License">
  <img src="https://img.shields.io/badge/TypeScript-007ACC?style=for-the-badge&logo=typescript&logoColor=white" alt="TypeScript">
</p>

<p align="center">
  <strong>Automatize leilões diretamente no Telegram</strong><br>
  Cadastro de usuários • Sincronização de status • Acompanhamento de editais
</p>

---

## 📋 Índice

- [✨ Funcionalidades](#-funcionalidades)
- [🚀 Começando](#-começando)
  - [Pré-requisitos](#pré-requisitos)
  - [Instalação](#instalação)
  - [Configuração](#configuração)
- [⚡ Execução](#-execução)
- [🏗️ Estrutura do Projeto](#️-estrutura-do-projeto)
- [📸 Demonstração](#-demonstração)
- [🤝 Contribuindo](#-contribuindo)
- [📞 Suporte](#-suporte)
- [📜 Licença](#-licença)

## ✨ Funcionalidades

### 🔐 **Sistema de Autenticação Segura**
- ✅ Cadastro com validação de e-mail
- ✅ Login com token JWT (JSON Web Token)
- ✅ Recuperação de senha
- ✅ Multi-fator de autenticação
- ✅ Controle de sessões ativas

### 🏷️ **Integração com Leilões**
- ✅ Sincronização automática de status
- ✅ Rastreamento de lances em tempo real
- ✅ Alertas personalizados por usuário
- ✅ Histórico completo de participações
- ✅ Integração com múltiplas plataformas

### ⚙️ **Painel Administrativo**
- ✅ Gerenciamento de usuários (CRUD completo)
- ✅ Monitoramento de atividades em tempo real
- ✅ Configurações flexíveis do sistema
- ✅ Dashboard com métricas e estatísticas
- ✅ Exportação de relatórios (PDF/Excel)

### 🔔 **Sistema de Notificações**
- ✅ Notificações push via Telegram
- ✅ Alertas por e-mail
- ✅ Configuração de preferências
- ✅ Histórico de notificações
- ✅ Sistema de silenciamento inteligente

## 🚀 Começando

### Pré-requisitos

Antes de começar, certifique-se de ter instalado:

- **Node.js** (versão 16 ou superior)
- **MySQL** (versão 8.0 ou superior)
- **npm** ou **yarn**
- **Git**
- Conta de Bot no Telegram ([@BotFather](https://t.me/botfather))

### Instalação

1. **Clone o repositório**
   ```bash
   git clone https://github.com/danielambrosim/SBL.git
   cd bot-leilao-telegram
   ```

2. **Instale as dependências**
   ```bash
   npm install
   # ou
   yarn install
   ```

3. **Configure as variáveis de ambiente**
   ```bash
   cp .env.example .env
   ```

### Configuração

Edite o arquivo `.env` com suas credenciais:

```env
# ======================
# CONFIGURAÇÕES DO SERVIDOR
# ======================
NODE_ENV=development
PORT=3000
APP_URL=http://localhost:3000

# ======================
# BANCO DE DADOS (MySQL)
# ======================
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=sua_senha
DB_NAME=bot-leilao-telegram_database

# ======================
# TELEGRAM BOT
# ======================
TELEGRAM_BOT_TOKEN=SEU_BOT_TOKEN_AQUI
TELEGRAM_WEBHOOK_SECRET=seu_segredo_webhook

# ======================
# AUTENTICAÇÃO JWT
# ======================
JWT_SECRET=seu_segredo_jwt_super_secreto
JWT_EXPIRES_IN=24h

# ======================
# E-MAIL (SMTP)
# ======================
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=seu_email@gmail.com
SMTP_PASS=sua_senha_app

# ======================
# REDIS (Cache/Sessões)
# ======================
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=
```

4. **Configure o banco de dados**
   ```bash
   # Crie o banco de dados no MySQL
   mysql -u root -p -e "CREATE DATABASE bot-leilao-telegram_database CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
   
   # Execute as migrações
   npm run migrate
   # ou
   yarn migrate
   ```

5. **Configure o Bot do Telegram**
   - Crie um bot com [@BotFather](https://t.me/botfather)
   - Obtenha o token do bot
   - Configure o webhook:
     ```bash
     npm run setup-webhook
     ```

## ⚡ Execução

### Modo Desenvolvimento (Hot-reload)
```bash
npm run dev
# ou
yarn dev
```

### Modo Produção
```bash
npm start
# ou
yarn start
```

### Comandos Adicionais
```bash
# Executar testes
npm test

# Verificar qualidade do código
npm run lint

# Build para produção
npm run build

# Backup do banco de dados
npm run backup

# Restaurar backup
npm run restore-backup
```

## 🏗️ Estrutura do Projeto

```
bot-leilao-telegram/
├── src/
│   ├── bots/           # Lógica do bot Telegram
│   │   ├── commands/   # Comandos do bot
│   │   ├── handlers/   # Handlers de mensagens
│   │   └── services/   # Serviços do bot
│   ├── controllers/    # Controladores da API
│   ├── models/         # Modelos do Sequelize
│   ├── routes/         # Rotas da API
│   ├── middleware/     # Middlewares
│   ├── utils/          # Utilitários
│   ├── config/         # Configurações
│   ├── migrations/     # Migrações do banco
│   └── seeders/        # Seeders do banco
├── public/             # Arquivos estáticos
├── docs/               # Documentação
├── tests/              # Testes
├── .env.example        # Template de variáveis
├── package.json        # Dependências
└── README.md           # Documentação principal
```

## 📸 Demonstração

<div align="center">
  <img src="https://i.imgur.com/exemplo1.png" width="30%" alt="Tela de Login" style="border-radius: 10px; margin: 5px;">
  <img src="https://i.imgur.com/exemplo2.png" width="30%" alt="Painel Administrativo" style="border-radius: 10px; margin: 5px;">
  <img src="https://i.imgur.com/exemplo3.png" width="30%" alt="Sistema de Notificações" style="border-radius: 10px; margin: 5px;">
</div>

## 🤝 Contribuindo

Contribuições são sempre bem-vindas! Veja como contribuir:

1. **Faça um Fork** do projeto
2. **Crie uma Branch** para sua feature:
   ```bash
   git checkout -b feature/nova-funcionalidade
   ```
3. **Commit suas mudanças**:
   ```bash
   git commit -m 'feat: adiciona nova funcionalidade'
   ```
4. **Push para a Branch**:
   ```bash
   git push origin feature/nova-funcionalidade
   ```
5. **Abra um Pull Request**

### Padrões de Commit
Usamos [Conventional Commits](https://www.conventionalcommits.org/):
- `feat:` Nova funcionalidade
- `fix:` Correção de bug
- `docs:` Documentação
- `style:` Formatação
- `refactor:` Refatoração
- `test:` Testes
- `chore:` Tarefas de manutenção

## 📞 Suporte

### Canais de Atendimento
- **📧 E-mail**: [dambrosimcolodete@gmail.com](mailto:dambrosimcolodete@gmail.com)
- **📱 Telegram**: [@danielcolodete](https://t.me/danielcolodete)
- **💼 LinkedIn**: [Daniel Colodete](https://www.linkedin.com/in/daniel-ambrosim-colodete/)
- **🐛 Issues**: [GitHub Issues](https://github.com/danielambrosim/bot-leilao-telegram/issues)

## 📜 Licença

Este projeto está licenciado sob a **Licença MIT** - veja o arquivo [LICENSE](LICENSE) para mais detalhes.

```text
MIT License

Copyright (c) 2024 Daniel Colodete

Permissão é concedida, gratuitamente, a qualquer pessoa que obtenha uma cópia
deste software e arquivos de documentação associados (o "Software"), para lidar
no Software sem restrição, incluindo sem limitação os direitos de usar, copiar,
modificar, mesclar, publicar, distribuir, sublicenciar e/ou vender cópias do
Software, e permitir que as pessoas a quem o Software é fornecido o façam...
```

---

<div align="center">
  <br>
  <p><strong>✨ Feito com ❤️ por <a href="https://github.com/danielambrosim">Daniel Colodete</a> ✨</strong></p>
  
  <p>
    <a href="https://github.com/danielambrosim/SBL/stargazers">
      <img src="https://img.shields.io/github/stars/danielambrosim/SBL?style=social" alt="Stars">
    </a>
    <a href="https://github.com/danielambrosim/SBL/forks">
      <img src="https://img.shields.io/github/forks/danielambrosim/SBL?style=social" alt="Forks">
    </a>
    <a href="https://github.com/danielambrosim/SBL/issues">
      <img src="https://img.shields.io/github/issues/danielambrosim/SBL" alt="Issues">
    </a>
  </p>
  
  <sub>Se este projeto te ajudou, considere dar uma ⭐ no repositório!</sub>
</div>
