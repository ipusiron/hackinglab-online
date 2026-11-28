// Reviewed prerequisites for selected tools. No DOM, network or storage access.
// Keep claims grounded in the tool's README; do not infer device compatibility
// or a completion time from a responsive layout or the tool's difficulty.
(function (root) {
  "use strict";

  const entries = {
    day003: {
      ja: {
        environment: "ブラウザー",
        prepare: "HELLOなど、英字の短い文字列を入力してください。"
      },
      en: {
        environment: "Web browser",
        prepare: "Enter a short text using English letters, such as HELLO."
      }
    },
    day007: {
      ja: {
        environment: "ブラウザー（JPEG/PNGのファイル選択）",
        prepare: "確認したい画像を1枚用意してください。使い方にテスト用画像もあります。"
      },
      en: {
        environment: "Web browser with JPEG/PNG file selection",
        prepare: "Have an image ready to inspect. A test image is also available in the usage guide."
      }
    },
    day015: {
      ja: {
        environment: "Google ColabとGoogleアカウント",
        prepare: "ノートブックを開き、設定セルの対象ドメインと実行回数を確認してください。"
      },
      en: {
        environment: "Google Colab and a Google account",
        prepare: "Open the notebook and check the domains and query count in the settings cell."
      }
    },
    day023: {
      ja: {
        environment: "Chrome・EdgeなどのChromium系ブラウザー",
        prepare: "サンプルから始められます。文字列を用意しなくても試せます。"
      },
      en: {
        environment: "A Chromium-based browser, such as Chrome or Edge",
        prepare: "Start with a built-in sample; you do not need to prepare your own text."
      }
    },
    day033: {
      ja: {
        environment: "HTTPSで開ける、Clipboard API対応ブラウザー",
        prepare: "コピー済みの内容をテスト用の文に替えてください。操作時にクリップボードの許可を求められる場合があります。"
      },
      en: {
        environment: "A browser with Clipboard API support, opened over HTTPS",
        prepare: "Replace your clipboard contents with test text first. The browser may ask for clipboard permission when you use the controls."
      }
    },
    day039: {
      ja: {
        environment: "ブラウザー",
        prepare: "整理したいhttp/httpsのURLを用意してください。使い方の例でも試せます。"
      },
      en: {
        environment: "Web browser",
        prepare: "Have an http/https URL ready to clean, or try an example from the usage guide."
      }
    },
    day041: {
      ja: {
        environment: "マイク付き端末のブラウザー（HTTPS）",
        prepare: "デモを開き、「記録開始」でマイクの使用を許可してください。"
      },
      en: {
        environment: "A browser on a device with a microphone, opened over HTTPS",
        prepare: "Open the demo, start logging, and allow microphone access."
      }
    },
    day050: {
      ja: {
        environment: "Chrome・Edge・Firefoxなどのブラウザー",
        prepare: "実物の金庫は不要です。画面の番号カードと自動実演を使えます。"
      },
      en: {
        environment: "A browser such as Chrome, Edge or Firefox",
        prepare: "No physical safe is needed. Use the on-screen combination card and automatic demonstration."
      }
    },
    day077: {
      ja: {
        environment: "JavaScriptが使えるブラウザー",
        prepare: "開くだけで観察できます。比較する場合は別のブラウザーかシークレットウィンドウを用意してください。"
      },
      en: {
        environment: "A browser with JavaScript enabled",
        prepare: "Open the page to inspect the results. For a comparison, use another browser or a private window."
      }
    },
    day113: {
      ja: {
        environment: "Raspberry Pi Zero W、Raspberry Pi OS、Python 3＋Flask",
        prepare: "USB HIDとWi-Fiの初期設定が必要です。自分が操作してよい接続先で、使い方の手順を確認してください。"
      },
      en: {
        environment: "Raspberry Pi Zero W, Raspberry Pi OS, Python 3 and Flask",
        prepare: "Set up USB HID and Wi-Fi first. Follow the usage guide with a target machine you are authorized to operate."
      }
    }
  };

  function get(dayId, lang) {
    if (typeof dayId !== "string" || !Object.prototype.hasOwnProperty.call(entries, dayId)) return null;
    const entry = entries[dayId][lang === "en" ? "en" : "ja"];
    // Do not expose the internal records to mutation by a renderer.
    return { environment: entry.environment, prepare: entry.prepare };
  }

  const api = Object.freeze({ get });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.HLOPreparation = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
