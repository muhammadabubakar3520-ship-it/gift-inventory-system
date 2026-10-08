'use strict';

/**
 * Starting data, upgrades of saved data and the start-up of the data layer.
 *
 * Admin login:
 *   ADMIN_EMAIL
 *   ADMIN_PASSWORD
 *
 * Promoter logins:
 *   src/seed/promoter-logins.json
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../config/env');

const DIR = path.join(__dirname, '..', 'seed');

const readJson = (fileName) => {
  const filePath = path.join(DIR, fileName);

  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
};

/* -------------------------------------------------------
   Promoter login hashing
------------------------------------------------------- */

const saltFor = (email) =>
  crypto
    .createHash('sha256')
    .update(`gift-ims-login|${String(email).toLowerCase()}`)
    .digest('hex')
    .slice(0, 32);

const hashFor = (password, email) => {
  const salt = saltFor(email);

  return `pbkdf2$210000$${salt}$${crypto
    .pbkdf2Sync(
      String(password),
      Buffer.from(salt, 'utf8'),
      210000,
      32,
      'sha256'
    )
    .toString('hex')}`;
};

function promoterLogins() {
  const file = process.env.PROMOTER_LOGINS_FILE
    ? path.resolve(process.env.PROMOTER_LOGINS_FILE)
    : path.join(DIR, 'promoter-logins.json');

  if (!fs.existsSync(file)) {
    return null;
  }

  const data = JSON.parse(fs.readFileSync(file, 'utf8'));

  const promoters = (data.promoters || []).map((user) => ({
    name: user.name,
    email: String(user.email).toLowerCase(),
    password_hash:
      user.password_hash || hashFor(user.password, user.email)
  }));

  const version = crypto
    .createHash('sha256')
    .update(JSON.stringify(promoters))
    .digest('hex')
    .slice(0, 16);

  return {
    version,
    promoters
  };
}

/* -------------------------------------------------------
   Starting data
------------------------------------------------------- */

const DATA = {
  STARTING_DATA:
    readJson('starting-data.json') || {
      promoters: [],
      shops: [],
      gifts: [],
      models: []
    },

  STARTING_BRANDS: readJson('brands.json'),

  PROMOTER_LOGINS: promoterLogins(),

  PROVIDED_SHOPS: readJson('provided-shops.json'),

  SHOP_ID_UPDATE: readJson('shop-id-update.json')
};

/* -------------------------------------------------------
   Register seed services
------------------------------------------------------- */

module.exports = function register(G) {
  const { S } = G;

  /* -----------------------------------------------------
     ADMIN ACCOUNT
  ----------------------------------------------------- */

  G.createAdmin = async (email, password) => {
    if (!email || !password) {
      throw new Error(
        'ADMIN_EMAIL and ADMIN_PASSWORD are required.'
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();

    return G.insert('users', {
      user_code: G.codes.admin(),
      name: 'System Admin',
      email: normalizedEmail,
      phone: null,
      password_hash: await G.hashPassword(password),
      role: 'admin',
      status: 'active',
      token_version: 0,
      last_login_at: null,
      created_at: G.now(),
      updated_at: G.now()
    });
  };

  /* -----------------------------------------------------
     PROMOTER LOGINS
  ----------------------------------------------------- */

  const LOGINS = () =>
    (DATA.PROMOTER_LOGINS &&
      DATA.PROMOTER_LOGINS.promoters) ||
    [];

  const loginFor = (name) =>
    LOGINS().find((user) => G.ieq(user.name, name));

  G.applyPromoterLogins = () => {
    let changed = false;

    for (const login of LOGINS()) {
      const user = S.users.find(
        (u) =>
          u.role === 'promoter' &&
          G.ieq(u.name, login.name)
      );

      if (!user) {
        continue;
      }

      const email = login.email.toLowerCase();

      const emailAvailable = !S.users.some(
        (u) =>
          u.id !== user.id &&
          G.ieq(u.email, email)
      );

      const changes = {};

      if (
        emailAvailable &&
        user.email !== email
      ) {
        changes.email = {
          from: user.email,
          to: email
        };

        user.email = email;
      }

      if (
        user.password_hash !==
        login.password_hash
      ) {
        user.password_hash =
          login.password_hash;

        user.token_version =
          (user.token_version || 0) + 1;

        S.sessions = S.sessions.filter(
          (session) =>
            session.user_id !== user.id
        );

        changes.password_set = true;
      }

      if (Object.keys(changes).length) {
        user.updated_at = G.now();

        G.audit(
          null,
          'user_updated',
          'user',
          user.user_code,
          {
            via: 'fixed promoter logins',
            ...changes
          }
        );

        changed = true;
      }
    }

    S.flags.promoterLogins =
      DATA.PROMOTER_LOGINS
        ? DATA.PROMOTER_LOGINS.version
        : null;

    return changed;
  };

  /* -----------------------------------------------------
     ENVIRONMENT ADMIN
  ----------------------------------------------------- */

  G.envAdminConfigured = () =>
    Boolean(
      config.ADMIN_EMAIL &&
      config.ADMIN_PASSWORD
    );

  G.isEnvAdmin = (user) =>
    Boolean(
      config.ADMIN_EMAIL &&
      user &&
      G.ieq(
        user.email,
        config.ADMIN_EMAIL
      )
    );

  G.ensureEnvAdmin = async () => {
    if (
      !config.ADMIN_EMAIL ||
      !config.ADMIN_PASSWORD
    ) {
      return null;
    }

    const email =
      String(config.ADMIN_EMAIL)
        .trim()
        .toLowerCase();

    let admin = S.users.find(
      (user) =>
        user.role === 'admin' &&
        G.ieq(user.email, email)
    );

    if (!admin) {
      admin = S.users.find(
        (user) =>
          G.ieq(user.email, email)
      );
    }

    if (admin) {
      admin.role = 'admin';
      admin.status = 'active';
      admin.password_hash =
        await G.hashPassword(
          config.ADMIN_PASSWORD
        );

      admin.token_version =
        (admin.token_version || 0) + 1;

      admin.updated_at = G.now();

      return admin;
    }

    return G.createAdmin(
      email,
      config.ADMIN_PASSWORD
    );
  };

  /* -----------------------------------------------------
     INITIAL DATABASE
  ----------------------------------------------------- */

  G.initData = async (store) => {
    await store.load();

    /*
     * Empty database:
     * Create Admin from environment variables.
     */
    if (!S.users.length) {
      if (
        !config.ADMIN_EMAIL ||
        !config.ADMIN_PASSWORD
      ) {
        throw new Error(
          'The database is empty. Set ADMIN_EMAIL and ADMIN_PASSWORD.'
        );
      }

      G.password(
        config.ADMIN_PASSWORD,
        'ADMIN_PASSWORD'
      );

      G.setState({});

      await G.createAdmin(
        config.ADMIN_EMAIL,
        config.ADMIN_PASSWORD
      );

      S.flags = {
        noOwnerContact: true,
        modelsAdded: true,
        brandsAdded: true,
        v5: true,
        shopIdsPK: true,
        shopsCleared1: true,
        noApproval1: true,
        shopsAdded2: true
      };

      if (config.SEED_DATA) {
        await G.loadStartingData();

        if (
          !(DATA.STARTING_DATA.shops || [])
            .length
        ) {
          G.addProvidedShops();
        }
      }

      S.flags.promoterLogins =
        DATA.PROMOTER_LOGINS
          ? DATA.PROMOTER_LOGINS.version
          : null;

      G.audit(
        null,
        'database_created',
        'system',
        null,
        {
          starting_data: config.SEED_DATA,
          shops: S.shops.length,
          promoters: S.users.filter(
            (u) => u.role === 'promoter'
          ).length,
          gifts: S.gifts.length
        }
      );

      await G.persist();

      return {
        created: true
      };
    }

    /*
     * Existing database:
     * Make sure the environment Admin exists.
     */
    if (G.envAdminConfigured()) {
      await G.ensureEnvAdmin();
    }

    /*
     * Apply promoter login updates.
     */
    if (
      DATA.PROMOTER_LOGINS &&
      S.flags.promoterLogins !==
        DATA.PROMOTER_LOGINS.version
    ) {
      G.applyPromoterLogins();
    }

    /*
     * Save changes.
     */
    await G.persist();

    return {
      created: false
    };
  };

  /* -----------------------------------------------------
     Expose seed data
  ----------------------------------------------------- */

  G.seedData = DATA;
};
