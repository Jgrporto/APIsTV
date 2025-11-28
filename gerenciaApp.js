import puppeteer from "puppeteer";

const LOGIN_URL = "https://gerenciaapp.top/login";
const CREATE_URL = "https://gerenciaapp.top/users/create";

const GERENCIA_USER = "da2298@br.com";
const GERENCIA_PASS = "90012345";

const FORM_DATA = {
  macLabel: "MAC DO DISPOSITIVO",
  macValue: "AB22",
  serverNameLabel: "NOME DO SERVER",
  serverNameValue: "TESTEAUTOMOCAO",
  m3uLabel: "LISTA M3U8",
  m3uValue: "TESTEM3U",
  epgLabel: "URL EPG",
  epgValue: "",
  appLabel: "APP QUE O CLIENTE USARA",
  appValue: "",
  priceLabel: "VALOR DA ASSINATURA",
  priceValue: "",
  nameLabel: "NOME",
  nameValue: "",
  phoneLabel: "WHATSAPP",
  phoneValue: "",
  notesLabel: "OBSERVACOES",
  notesValue: ""
};

async function dumpLabels(page) {
  const labels = await page.evaluate(() =>
    Array.from(document.querySelectorAll("label")).map((l) => ({
      text: (l.textContent || "").trim(),
      forAttr: l.getAttribute("for") || null,
      hasInput: !!l.querySelector("input, select, textarea")
    }))
  );
  console.log("Labels encontrados na pagina de cadastro:");
  labels
    .slice(0, 50)
    .forEach((l, idx) => console.log(`${idx + 1}. "${l.text}" for=${l.forAttr} hasInput=${l.hasInput}`));
}

async function dumpInputs(page) {
  const inputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll("input, select, textarea")).map((el, idx) => ({
      idx,
      tag: el.tagName,
      type: el.type || "",
      name: el.name || "",
      id: el.id || "",
      placeholder: el.placeholder || "",
      className: el.className || ""
    }))
  );
  console.log("Inputs encontrados na pagina de cadastro:");
  inputs.slice(0, 50).forEach((i) =>
    console.log(
      `${i.idx}. <${i.tag.toLowerCase()}> type=${i.type} name="${i.name}" id="${i.id}" placeholder="${i.placeholder}" class="${i.className}"`
    )
  );
}

async function fillByLabel(page, labelText, value) {
  const result = await page.evaluate(
    (labelTextArg, valueArg) => {
      const labels = Array.from(document.querySelectorAll("label"));
      const target = labels.find((l) =>
        (l.textContent || "").toUpperCase().includes(labelTextArg.toUpperCase())
      );

      if (!target) return { ok: false, reason: `Label "${labelTextArg}" not found` };

      const findControl = (labelEl) => {
        // 1) for/id
        const forAttr = labelEl.getAttribute("for");
        if (forAttr) {
          const byId = document.getElementById(forAttr);
          if (byId) return byId;
        }
        // 2) inside same parent
        const parent = labelEl.parentElement;
        if (parent) {
          const inside = parent.querySelector("input, select, textarea");
          if (inside && inside !== labelEl) return inside;
        }
        // 3) next sibling
        let sib = labelEl.nextElementSibling;
        while (sib) {
          if (sib.matches("input, select, textarea")) return sib;
          const nested = sib.querySelector && sib.querySelector("input, select, textarea");
          if (nested) return nested;
          sib = sib.nextElementSibling;
        }
        // 4) first input/select/textarea after label in DOM order
        const walker = document.createTreeWalker(
          document.body,
          NodeFilter.SHOW_ELEMENT,
          {
            acceptNode(node) {
              if (node.matches && node.matches("input, select, textarea")) return NodeFilter.FILTER_ACCEPT;
              return NodeFilter.FILTER_SKIP;
            }
          }
        );
        let found = null;
        let started = false;
        while (walker.nextNode()) {
          const node = walker.currentNode;
          if (node === labelEl) {
            started = true;
            continue;
          }
          if (started && node.matches && node.matches("input, select, textarea")) {
            found = node;
            break;
          }
        }
        return found;
      };

      const control = findControl(target);
      if (!control) return { ok: false, reason: `Input for "${labelTextArg}" not found` };

      const tag = (control.tagName || "").toLowerCase();
      if (tag === "select") {
        const options = Array.from(control.options || []);
        const match = options.find(
          (o) =>
            (o.textContent || "").toUpperCase().includes(valueArg.toUpperCase()) ||
            (o.value || "").toUpperCase() === valueArg.toUpperCase()
        );
        if (match) {
          control.value = match.value;
          control.dispatchEvent(new Event("change", { bubbles: true }));
        } else {
          return { ok: false, reason: `Option "${valueArg}" not found for "${labelTextArg}"` };
        }
      } else {
        control.value = "";
        control.dispatchEvent(new Event("input", { bubbles: true }));
        control.value = valueArg;
        control.dispatchEvent(new Event("input", { bubbles: true }));
      }

      return { ok: true };
    },
    labelText,
    value
  );

  if (!result.ok) {
    throw new Error(result.reason);
  }
}

async function clickSubmit(page) {
  const submitClicked = await page.evaluate(() => {
    const candidates = Array.from(
      document.querySelectorAll(
        'button[type="submit"], input[type="submit"], button, input[type="button"]'
      )
    );

    const target = candidates.find((el) => {
      const text = (el.textContent || el.value || "").toUpperCase();
      return text.includes("ENVIAR") || text.includes("SALVAR") || text.includes("CRIAR");
    });

    if (target) {
      target.click();
      return true;
    }
    return false;
  });

  if (!submitClicked) {
    await page.click('button[type="submit"]');
  }
}

export async function criarUsuarioGerenciaApp() {
  return criarUsuarioGerenciaAppComM3u(FORM_DATA.m3uValue);
}

export async function criarUsuarioGerenciaAppComM3u(m3uValue, options = {}) {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const {
    mac = FORM_DATA.macValue,
    serverName = FORM_DATA.serverNameValue,
    epg = FORM_DATA.epgValue,
    app = FORM_DATA.appValue,
    price = FORM_DATA.priceValue,
    nome = FORM_DATA.nameValue,
    whatsapp = FORM_DATA.phoneValue,
    observacoes = FORM_DATA.notesValue
  } = options;

  try {
    console.log("Acessando tela de login do GerenciaApp...");
    await page.goto(LOGIN_URL, { waitUntil: "networkidle2" });

    await page.type('input[type="email"], input[name="email"]', GERENCIA_USER, { delay: 20 });
    await page.type('input[type="password"], input[name="password"]', GERENCIA_PASS, { delay: 20 });

    // Tenta localizar botao de submit de forma mais flexivel, senao usa Enter
    const foundSubmit = await page.evaluate(() => {
      const candidates = Array.from(
        document.querySelectorAll('button, input[type="submit"], input[type="button"]')
      );
      const target =
        candidates.find((el) => {
          const text = (el.textContent || el.value || "").toUpperCase();
          return (
            text.includes("ENTRAR") ||
            text.includes("LOGIN") ||
            text.includes("LOGAR") ||
            text.includes("ACESSAR") ||
            text.includes("ENVIAR") ||
            el.type === "submit"
          );
        }) || candidates[0];

      if (target) {
        target.click();
        return true;
      }
      return false;
    });

    if (!foundSubmit) {
      // fallback: pressiona Enter no campo de senha
      const passwordInput =
        (await page.$('input[type="password"], input[name="password"]')) || null;
      if (!passwordInput) throw new Error("Campo de senha nao encontrado");
      await passwordInput.press("Enter");
    }

    await page.waitForNavigation({ waitUntil: "networkidle2" });

    console.log("Login concluido, abrindo tela de cadastro...");
    await page.goto(CREATE_URL, { waitUntil: "networkidle2" });

    try {
      const camposParaPreencher = [
        [FORM_DATA.macLabel, mac],
        [FORM_DATA.serverNameLabel, serverName],
        [FORM_DATA.m3uLabel, m3uValue || FORM_DATA.m3uValue],
        [FORM_DATA.epgLabel, epg],
        [FORM_DATA.appLabel, app],
        [FORM_DATA.priceLabel, price],
        [FORM_DATA.nameLabel, nome],
        [FORM_DATA.phoneLabel, whatsapp],
        [FORM_DATA.notesLabel, observacoes]
      ].filter(([label]) => !!label);

      for (const [label, value] of camposParaPreencher) {
        if (value === undefined || value === null) continue;
        await fillByLabel(page, label, value);
      }
    } catch (err) {
      await dumpLabels(page);
      await dumpInputs(page);
      throw err;
    }

    console.log("Campos preenchidos, enviando formulario...");
    await clickSubmit(page);
    await page.waitForNavigation({ waitUntil: "networkidle2" }).catch(() => {});

    console.log("Cadastro enviado no GerenciaApp.");
  } catch (error) {
    console.error("Erro na automacao GerenciaApp:", error.message);
    throw error;
  } finally {
    await browser.close();
  }
}
