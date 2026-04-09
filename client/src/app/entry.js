import { formatMoney, formatDateTime, isToday } from "../utils/format.js";
import { escapeHtml, attrEscape } from "../utils/html.js";
import {
  piggyTierEmoji,
  goalMapDotsHtml,
  goalAlmostThereHtml,
} from "../utils/goalVisual.js";
import {
  CLIENT_ID_KEY,
  LEGACY_STATE_KEY,
  LEGACY_SESSION_KEY,
  LEGACY_EXTRAS_KEY,
  getApiBase,
} from "../config.js";

export function startApp() {
  var MOCK = window.ZERNYSHKO_MOCK;
  if (!MOCK) {
    console.error("ZERNYSHKO_MOCK не загружен");
    return;
  }

  /** Источник истины — ответ сервера и PUT в БД; localStorage только для client_id. */
  var serverAppState = null;
  var serverSession = null;
  var serverExtras = {};
  var serverSessionTouched = false;


  var API_BASE = getApiBase();

  var serverPushTimer = null;

  function apiUrl(path) {
    var base = API_BASE || "";
    if (!path.startsWith("/")) path = "/" + path;
    return base + path;
  }

  function generateClientId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function getClientId() {
    return localStorage.getItem(CLIENT_ID_KEY);
  }

  function ensureClientId() {
    var id = getClientId();
    if (!id) {
      id = generateClientId();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  }

  function clonePersisted(obj) {
    return JSON.parse(JSON.stringify(obj));
  }

  function getExtras() {
    return Object.assign({}, serverExtras);
  }

  function setServerStatusLine(text, ok) {
    var el = document.getElementById("serverSyncStatus");
    if (!el) return;
    el.textContent = text;
    el.classList.remove("server-sync--ok", "server-sync--warn");
    el.classList.add(ok ? "server-sync--ok" : "server-sync--warn");
  }

  function mergeIncomingAppState(parsed) {
    var base = defaultState();
    if (typeof parsed.balance === "number") base.balance = parsed.balance;
    if (Array.isArray(parsed.extraTransactions))
      base.extraTransactions = parsed.extraTransactions;
    if (parsed.settings) {
      base.settings.dailyLimit =
        typeof parsed.settings.dailyLimit === "number"
          ? parsed.settings.dailyLimit
          : base.settings.dailyLimit;
      base.settings.cardBlocked = !!parsed.settings.cardBlocked;
      base.settings.perTxnLimit =
        typeof parsed.settings.perTxnLimit === "number"
          ? parsed.settings.perTxnLimit
          : base.settings.perTxnLimit;
    }
    return base;
  }

  function applyServerPayload(data) {
    if (!data || typeof data !== "object") return;
    if (data.app_state != null && typeof data.app_state === "object") {
      serverAppState = mergeIncomingAppState(data.app_state);
    } else {
      serverAppState = defaultState();
    }
    if (Object.prototype.hasOwnProperty.call(data, "session")) {
      serverSessionTouched = true;
      if (data.session === null) serverSession = null;
      else serverSession = data.session;
    }
    var hasExtrasRoot = data.extras != null && typeof data.extras === "object";
    var hasKv =
      data.extras_kv != null &&
      typeof data.extras_kv === "object" &&
      Object.keys(data.extras_kv).length > 0;
    if (hasExtrasRoot || hasKv) {
      var ex = hasExtrasRoot ? Object.assign({}, data.extras) : {};
      if (hasKv) Object.assign(ex, data.extras_kv);
      serverExtras = ex;
    }
  }

  /** Если в БД ещё нет данных, подтянуть разовый перенос из старого localStorage. */
  function migrateLegacyIfServerEmpty(data) {
    if (data.app_state != null) return;
    try {
      var raw = localStorage.getItem(LEGACY_STATE_KEY);
      if (!raw) return;
      serverAppState = mergeIncomingAppState(JSON.parse(raw));
      localStorage.removeItem(LEGACY_STATE_KEY);
      var sr = localStorage.getItem(LEGACY_SESSION_KEY);
      if (sr) {
        serverSession = JSON.parse(sr);
        serverSessionTouched = true;
        localStorage.removeItem(LEGACY_SESSION_KEY);
      }
      var er = localStorage.getItem(LEGACY_EXTRAS_KEY);
      if (er) {
        serverExtras = JSON.parse(er);
        if (typeof serverExtras !== "object" || serverExtras === null)
          serverExtras = {};
        localStorage.removeItem(LEGACY_EXTRAS_KEY);
      }
      scheduleServerPush();
    } catch (e) {}
  }

  function pullFromServer() {
    var cid = getClientId();
    if (!cid) return Promise.resolve();
    return fetch(apiUrl("/api/client/" + encodeURIComponent(cid)), {
      method: "GET",
      headers: { Accept: "application/json" },
    })
      .then(function (r) {
        if (!r.ok) throw new Error("http " + r.status);
        return r.json();
      })
      .then(function (data) {
        applyServerPayload(data);
        migrateLegacyIfServerEmpty(data);
        setServerStatusLine("Сервер: данные подтянуты", true);
      })
      .catch(function () {
        setServerStatusLine(
          "Сервер недоступен — изменения не сохранятся в базе",
          false
        );
        if (serverAppState === null) serverAppState = defaultState();
        if (!serverSessionTouched) serverSession = null;
      });
  }

  function pushFullSnapshot() {
    var cid = getClientId();
    if (!cid) return;
    var appPayload =
      serverAppState != null ? clonePersisted(serverAppState) : defaultState();
    fetch(apiUrl("/api/client/" + encodeURIComponent(cid)), {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        app_state: appPayload,
        session: serverSession,
        extras: getExtras(),
      }),
    }).catch(function () {});
  }

  function scheduleServerPush() {
    clearTimeout(serverPushTimer);
    serverPushTimer = setTimeout(pushFullSnapshot, 450);
  }

  var lastHistoryTrackTs = 0;

  function postTrack(eventName) {
    var cid = getClientId();
    if (!cid) return;
    fetch(apiUrl("/api/client/" + encodeURIComponent(cid) + "/track"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ event: eventName }),
    }).catch(function () {});
  }

  function refreshGoalTab() {
    postTrack("goal_view");
    var cid = getClientId();
    if (!cid) return;
    Promise.all([
      fetch(apiUrl("/api/client/" + encodeURIComponent(cid) + "/goals")).then(
        function (r) {
          return r.json();
        }
      ),
      fetch(
        apiUrl("/api/client/" + encodeURIComponent(cid) + "/achievements")
      ).then(function (r) {
        return r.json();
      }),
      fetch(
        apiUrl("/api/client/" + encodeURIComponent(cid) + "/goal-steps")
      ).then(function (r) {
        return r.json();
      }),
    ])
      .then(function (triple) {
        renderGoalActive(
          (triple[0] && triple[0].goals) || [],
          (triple[2] && triple[2].steps) || []
        );
        renderAchievementsList((triple[1] && triple[1].achievements) || []);
      })
      .catch(function () {});
  }

  function renderGoalActive(goals, goalSteps) {
    var mount = document.getElementById("goalActiveMount");
    if (!mount) return;
    var byGoal = {};
    (goalSteps || []).forEach(function (s) {
      if (!byGoal[s.goal_id]) byGoal[s.goal_id] = [];
      byGoal[s.goal_id].push(s);
    });
    var activeGoals = goals.filter(function (x) {
      return x.active;
    });
    if (!activeGoals.length) {
      mount.innerHTML =
        '<p class="muted">Пока нет целей. Заполни форму выше и нажми «Сохранить цель».</p>';
      return;
    }
    var cardsHtml = activeGoals
      .map(function (g) {
        var pct = Math.min(
          100,
          Math.round((g.saved_total / g.target_amount) * 100)
        );
        var tier = piggyTierEmoji(pct);
        var almost = goalAlmostThereHtml(g);
        var mapDots = goalMapDotsHtml(pct);
        var steps = byGoal[g.id] || [];
        var stepsHtml;
        if (steps.length) {
          stepsHtml =
            '<ul class="goal-steps-list" style="margin:0.5rem 0 0;padding-left:1.1rem;font-size:0.88rem">' +
            steps
              .map(function (s) {
                var line =
                  "<li style=\"margin:0.35rem 0\">" +
                  "<span>" +
                  escapeHtml(s.title) +
                  "</span>";
                if (s.reward_amount > 0)
                  line +=
                    ' <span class="muted">· ' +
                    formatMoney(s.reward_amount) +
                    "</span>";
                line += "<br/>";
                if (s.status === "open") {
                  line +=
                    '<button type="button" class="btn btn-primary btn-sm" style="margin-top:0.35rem" data-step-done="' +
                    attrEscape(s.id) +
                    '" data-goal-id="' +
                    attrEscape(g.id) +
                    '">Я выполнил</button>';
                } else if (s.status === "done_pending") {
                  line +=
                    '<span class="badge-tiny">Ждёт подтверждения</span>';
                } else if (s.status === "paid") {
                  line += '<span class="badge-tiny">Зачтено</span>';
                } else if (s.status === "rejected") {
                  line +=
                    '<span class="badge-tiny badge-tiny--muted">Отклонено</span>';
                  if (s.parent_note)
                    line +=
                      ' <span class="muted">' +
                      escapeHtml(s.parent_note) +
                      "</span>";
                }
                line += "</li>";
                return line;
              })
              .join("") +
            "</ul>";
        } else {
          stepsHtml =
            '<p class="muted" style="margin:0.5rem 0 0;font-size:0.82rem">Пока нет шагов — добавь ниже.</p>';
        }
        var formHtml =
          '<div class="goal-step-form" style="margin-top:0.65rem;padding-top:0.65rem;border-top:1px solid rgba(0,0,0,0.06)">' +
          '<span class="goal-subtitle" style="font-size:0.85rem">Шаги к цели</span>' +
          stepsHtml +
          '<label class="goal-label" style="margin-top:0.5rem;font-size:0.8rem">Название шага</label>' +
          '<input type="text" class="goal-input goal-step-title" maxlength="500" placeholder="Например: неделю копил из карманных" data-goal-id="' +
          attrEscape(g.id) +
          '" />' +
          '<label class="goal-label" style="font-size:0.8rem">Награда на цель от мамы (₽)</label>' +
          '<input type="number" class="goal-input goal-step-reward" min="0" step="50" placeholder="0 — только галочка" data-goal-id="' +
          attrEscape(g.id) +
          '" />' +
          '<button type="button" class="btn btn-ghost btn-sm" data-add-step data-goal-id="' +
          attrEscape(g.id) +
          '">Добавить шаг</button>' +
          "</div>";
        return (
          '<div class="app-card goal-active-card goal-active-card--compact" data-goal-id="' +
          attrEscape(g.id) +
          '">' +
          '<div class="goal-card-head">' +
          '<span class="goal-tier-emoji" aria-hidden="true">' +
          tier +
          "</span>" +
          '<h3 class="goal-subtitle goal-subtitle--inline">' +
          escapeHtml(g.title) +
          "</h3></div>" +
          '<p class="muted">До ' +
          escapeHtml(g.deadline) +
          " · ~ " +
          formatMoney(g.weekly_amount) +
          " в неделю (" +
          g.num_weeks +
          " нед.)</p>" +
          almost +
          mapDots +
          '<div class="piggy-bar" style="margin:0.75rem 0"><div class="piggy-bar__fill" style="width:' +
          pct +
          '%"></div></div>' +
          "<p><strong>" +
          formatMoney(g.saved_total) +
          "</strong> из " +
          formatMoney(g.target_amount) +
          " · " +
          pct +
          "%</p>" +
          '<div class="goal-card-actions">' +
          '<button type="button" class="btn btn-primary btn-sm" data-goal-contrib="' +
          attrEscape(g.id) +
          '" data-goal-title="' +
          attrEscape(g.title) +
          '">Внести</button>' +
          "</div>" +
          formHtml +
          "</div>"
        );
      })
      .join("");

    var merged = [];
    activeGoals.forEach(function (g) {
      (g.contributions || []).forEach(function (c) {
        merged.push({
          goalTitle: g.title,
          amount: c.amount,
          at: c.at,
        });
      });
    });
    merged.sort(function (a, b) {
      return new Date(b.at) - new Date(a.at);
    });
    merged = merged.slice(0, 12);

    mount.innerHTML =
      '<div class="goal-cards-stack">' +
      cardsHtml +
      "</div>" +
      '<h4 class="goal-subtitle" style="margin-top:1rem;font-size:0.9rem">Недавние взносы</h4>' +
      '<ul class="tx-list">' +
      merged
        .map(function (c) {
          return (
            '<li class="tx-item"><div><div class="tx-item__title">' +
            formatMoney(c.amount) +
            '</div><div class="tx-item__meta">' +
            escapeHtml(c.goalTitle) +
            " · " +
            escapeHtml(formatDateTime(c.at)) +
            "</div></div></li>"
          );
        })
        .join("") +
      "</ul>";

    bindGoalContribMountOnce();
    bindGoalStepEventsOnce();
  }

  function bindGoalStepEventsOnce() {
    var mount = document.getElementById("goalActiveMount");
    if (!mount || mount.dataset.goalStepBound) return;
    mount.dataset.goalStepBound = "1";
    mount.addEventListener("click", function (e) {
      var doneBtn = e.target.closest("[data-step-done]");
      if (doneBtn && mount.contains(doneBtn)) {
        e.preventDefault();
        var gid = doneBtn.getAttribute("data-goal-id");
        var sid = doneBtn.getAttribute("data-step-done");
        var cid = getClientId();
        if (!cid || !gid || !sid) return;
        fetch(
          apiUrl(
            "/api/client/" +
              encodeURIComponent(cid) +
              "/goals/" +
              encodeURIComponent(gid) +
              "/steps/" +
              encodeURIComponent(sid) +
              "/done"
          ),
          { method: "POST", headers: { "Content-Type": "application/json" } }
        )
          .then(function (r) {
            return r.json().then(function (body) {
              if (!r.ok) throw new Error((body && body.message) || "");
            });
          })
          .then(function () {
            refreshGoalTab();
            loadParentGrowth();
          })
          .catch(function () {});
        return;
      }
      var addBtn = e.target.closest("[data-add-step]");
      if (addBtn && mount.contains(addBtn)) {
        e.preventDefault();
        var goalId = addBtn.getAttribute("data-goal-id");
        var card = addBtn.closest(".goal-active-card");
        if (!card || !goalId) return;
        var titleInp = card.querySelector(".goal-step-title");
        var rewInp = card.querySelector(".goal-step-reward");
        var title = titleInp ? titleInp.value.trim() : "";
        var reward = rewInp ? parseInt(rewInp.value, 10) : 0;
        if (!title) {
          if (titleInp) titleInp.focus();
          return;
        }
        if (isNaN(reward) || reward < 0) reward = 0;
        var cid2 = getClientId();
        if (!cid2) return;
        fetch(
          apiUrl(
            "/api/client/" +
              encodeURIComponent(cid2) +
              "/goals/" +
              encodeURIComponent(goalId) +
              "/steps"
          ),
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              title: title,
              reward_amount: reward,
            }),
          }
        )
          .then(function (r) {
            return r.json().then(function (body) {
              if (!r.ok) throw new Error();
            });
          })
          .then(function () {
            if (titleInp) titleInp.value = "";
            if (rewInp) rewInp.value = "";
            refreshGoalTab();
            loadParentGrowth();
          })
          .catch(function () {});
        return;
      }
    });
  }

  function parentApproveStep(goalId, stepId) {
    var cid = getClientId();
    if (!cid || !goalId || !stepId) return;
    fetch(
      apiUrl(
        "/api/client/" +
          encodeURIComponent(cid) +
          "/goals/" +
          encodeURIComponent(goalId) +
          "/steps/" +
          encodeURIComponent(stepId) +
          "/approve"
      ),
      { method: "POST", headers: { "Content-Type": "application/json" } }
    )
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error((body && body.message) || "");
          return body;
        });
      })
      .then(function () {
        loadParentGrowth();
        if (loadSession() && loadSession().role === "child") {
          pullFromServer().then(function () {
            state = loadState();
            renderChildHome();
            refreshGoalTab();
            renderPiggy();
          });
        }
      })
      .catch(function () {});
  }

  function parentRejectStep(goalId, stepId) {
    var note = window.prompt(
      "Комментарий для ребёнка (необязательно). Отмена — не отклонять.",
      ""
    );
    if (note === null) return;
    var cid = getClientId();
    if (!cid || !goalId || !stepId) return;
    fetch(
      apiUrl(
        "/api/client/" +
          encodeURIComponent(cid) +
          "/goals/" +
          encodeURIComponent(goalId) +
          "/steps/" +
          encodeURIComponent(stepId) +
          "/reject"
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ parent_note: note }),
      }
    )
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) throw new Error();
        });
      })
      .then(function () {
        loadParentGrowth();
        if (loadSession() && loadSession().role === "child") refreshGoalTab();
      })
      .catch(function () {});
  }

  function submitContribute(amount, msgEl) {
    var msg = msgEl || null;
    var ctx = goalContributeContext;
    if (!ctx.id) {
      if (msg) {
        msg.className = "alert alert--error";
        msg.textContent =
          ctx.kind === "piggy" ? "Копилка не выбрана." : "Цель не выбрана.";
      }
      return;
    }
    if (!amount || amount < 1) {
      if (msg) {
        msg.className = "alert alert--error";
        msg.textContent = "Введи сумму.";
      }
      return;
    }
    var cid = getClientId();
    var path =
      ctx.kind === "piggy"
        ? "/piggy-banks/" + encodeURIComponent(ctx.id) + "/contribute"
        : "/goals/" + encodeURIComponent(ctx.id) + "/contribute";
    fetch(apiUrl("/api/client/" + encodeURIComponent(cid) + path), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ amount: amount }),
    })
      .then(function (r) {
        return r.json().then(function (body) {
          if (!r.ok) {
            var err = new Error(
              (body && body.message) || "Не удалось сохранить взнос"
            );
            err.body = body;
            throw err;
          }
          return body;
        });
      })
      .then(function () {
        exitGoalContributeScreen();
        return pullFromServer();
      })
      .then(function () {
        state = loadState();
        renderChildHome();
        renderHistory();
        refreshGoalTab();
        renderPiggy();
        loadParentGrowth();
      })
      .catch(function (err) {
        if (msg) {
          msg.className = "alert alert--error";
          msg.classList.remove("hidden");
          msg.textContent =
            (err && err.message) || "Не удалось сохранить. Проверь сервер.";
        }
      });
  }

  function renderAchievementsList(list) {
    var ul = document.getElementById("goalAchievementsList");
    if (!ul) return;
    if (!list.length) {
      ul.innerHTML =
        '<li class="muted">Пока пусто. Взнос по плану, умеренные траты за неделю или 3+ раза вкладка «История» — и ачивка появится здесь.</li>';
      return;
    }
    ul.innerHTML = list
      .map(function (a) {
        return (
          '<li class="achievement-row"><span class="achievement-row__badge" aria-hidden="true">🏅</span><div><strong>' +
          escapeHtml(a.title) +
          '</strong><p class="muted" style="margin:0.2rem 0 0;font-size:0.8rem">' +
          escapeHtml(a.week_id) +
          " · " +
          escapeHtml(formatDateTime(a.unlocked_at)) +
          "</p></div></li>"
        );
      })
      .join("");
  }

  function bindParentStepsMountOnce() {
    var psm = document.getElementById("parentStepsMount");
    if (!psm || psm.dataset.bound) return;
    psm.dataset.bound = "1";
    psm.addEventListener("click", function (e) {
      var a = e.target.closest(".parent-step-approve");
      if (a && psm.contains(a)) {
        var row = a.closest(".parent-step-row");
        if (row)
          parentApproveStep(
            row.getAttribute("data-step-gid"),
            row.getAttribute("data-step-sid")
          );
        return;
      }
      var rej = e.target.closest(".parent-step-reject");
      if (rej && psm.contains(rej)) {
        var row2 = rej.closest(".parent-step-row");
        if (row2)
          parentRejectStep(
            row2.getAttribute("data-step-gid"),
            row2.getAttribute("data-step-sid")
          );
      }
    });
  }

  function loadParentGrowth() {
    var cid = getClientId();
    if (!cid) return;
    bindParentStepsMountOnce();
    var dm = document.getElementById("parentDigestMount");
    var im = document.getElementById("parentIdeasMount");
    var sm = document.getElementById("parentStepsMount");
    fetch(
      apiUrl(
        "/api/client/" +
          encodeURIComponent(cid) +
          "/goal-steps?status=done_pending"
      )
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!sm) return;
        var list = (d && d.steps) || [];
        if (!list.length) {
          sm.innerHTML =
            '<p class="muted" style="margin:0">Нет шагов на подтверждение.</p>';
          return;
        }
        sm.innerHTML = list
          .map(function (s) {
            return (
              '<div class="parent-step-row" data-step-gid="' +
              attrEscape(s.goal_id) +
              '" data-step-sid="' +
              attrEscape(s.id) +
              '">' +
              '<p class="muted" style="margin:0;font-size:0.82rem">' +
              escapeHtml(s.goal_title) +
              "</p>" +
              "<p><strong>" +
              escapeHtml(s.title) +
              "</strong></p>" +
              '<p class="muted" style="margin:0.35rem 0 0;font-size:0.85rem">Награда на цель: ' +
              formatMoney(s.reward_amount) +
              "</p>" +
              '<div style="margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.35rem">' +
              '<button type="button" class="btn btn-primary btn-sm parent-step-approve">Зачесть и перевести</button>' +
              '<button type="button" class="btn btn-ghost btn-sm parent-step-reject">Отклонить</button>' +
              "</div></div>"
            );
          })
          .join("");
      })
      .catch(function () {
        if (sm) sm.textContent = "Не удалось загрузить шаги.";
      });

    fetch(apiUrl("/api/client/" + encodeURIComponent(cid) + "/parent-digest"))
      .then(function (r) {
        return r.json();
      })
      .then(function (d) {
        if (!dm) return;
        var html = "";
        var goalList =
          d.goals && d.goals.length
            ? d.goals
            : d.goal
              ? [d.goal]
              : [];
        if (!goalList.length) {
          html +=
            "<p>Ребёнок ещё не завёл целей. Вкладка «Цель» в детском кабинете.</p>";
        } else {
          goalList.forEach(function (g) {
            html +=
              "<p><strong>" +
              escapeHtml(g.title) +
              "</strong></p><p>Накоплено: " +
              formatMoney(g.saved) +
              " из " +
              formatMoney(g.target) +
              ". За эту неделю: план " +
              formatMoney(g.weekly_plan) +
              ", факт " +
              formatMoney(g.weekly_fact) +
              ".</p><p>" +
              (g.on_track
                ? "В графике по недельному взносу."
                : "Ниже недельного плана — можно мягко обсудить причины.") +
              "</p>";
          });
        }
        if (d.achievements_week && d.achievements_week.length) {
          html +=
            '<p style="margin-top:0.6rem"><strong>Ачивки недели:</strong> ' +
            d.achievements_week
              .map(function (x) {
                return escapeHtml(x.title);
              })
              .join(", ") +
            "</p>";
        }
        html +=
          '<p class="digest-talk" style="margin-top:0.75rem"><strong>Тема для разговора:</strong> ' +
          escapeHtml(d.talk_topic) +
          "</p>";
        if (d.pending_ideas)
          html +=
            '<p class="muted" style="margin-top:0.5rem">Идей на подтверждение: ' +
            d.pending_ideas +
            "</p>";
        dm.innerHTML = html;
      })
      .catch(function () {
        if (dm) dm.textContent = "Не удалось загрузить дайджест.";
      });

    fetch(
      apiUrl(
        "/api/client/" +
          encodeURIComponent(cid) +
          "/savings-ideas?status=pending"
      )
    )
      .then(function (r) {
        return r.json();
      })
      .then(function (data) {
        if (!im) return;
        var ideas = data.ideas || [];
        if (!ideas.length) {
          im.innerHTML = '<p class="muted">Нет ожидающих идей.</p>';
          return;
        }
        im.innerHTML = ideas
          .map(function (idea) {
            return (
              '<div class="idea-pending" data-idea-id="' +
              escapeHtml(idea.id) +
              '"><p>' +
              escapeHtml(idea.text) +
              '</p><div class="idea-pending__actions"><button type="button" class="btn btn-primary btn-sm idea-approve">Подтвердить</button><button type="button" class="btn btn-ghost btn-sm idea-reject">Отклонить</button></div></div>'
            );
          })
          .join("");
        im.querySelectorAll(".idea-approve").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var wrap = btn.closest(".idea-pending");
            if (wrap) resolveIdea(wrap.getAttribute("data-idea-id"), "approve");
          });
        });
        im.querySelectorAll(".idea-reject").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var wrap = btn.closest(".idea-pending");
            if (wrap) resolveIdea(wrap.getAttribute("data-idea-id"), "reject");
          });
        });
      })
      .catch(function () {
        if (im) im.textContent = "Не удалось загрузить идеи.";
      });
  }

  function resolveIdea(ideaId, action) {
    var cid = getClientId();
    fetch(
      apiUrl(
        "/api/client/" +
          encodeURIComponent(cid) +
          "/savings-ideas/" +
          encodeURIComponent(ideaId) +
          "/resolve"
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: action }),
      }
    )
      .then(function (r) {
        if (!r.ok) throw new Error();
        loadParentGrowth();
        if (loadSession() && loadSession().role === "child") refreshGoalTab();
      })
      .catch(function () {});
  }

  function onCreateGoal() {
    var titleEl = document.getElementById("goalFormTitle");
    var targetEl = document.getElementById("goalFormTarget");
    var dateEl = document.getElementById("goalFormDeadline");
    var msg = document.getElementById("goalFormMsg");
    var title = titleEl ? titleEl.value.trim() : "";
    var target = targetEl ? parseInt(targetEl.value, 10) : 0;
    var deadline = dateEl ? dateEl.value : "";
    if (!title || !target || !deadline) {
      if (msg) {
        msg.className = "alert alert--error";
        msg.textContent = "Заполни все поля.";
      }
      return;
    }
    var cid = getClientId();
    fetch(apiUrl("/api/client/" + encodeURIComponent(cid) + "/goals"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: title,
        target_amount: target,
        deadline: deadline,
      }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(function (j) {
        if (msg) {
          msg.className = "alert alert--ok";
          msg.textContent =
            "Цель добавлена. Примерно " +
            formatMoney(j.weekly_amount) +
            " в неделю на эту цель. Копилка создана — раздел «Копилка».";
        }
        refreshGoalTab();
        renderPiggy();
        renderChildHome();
        loadParentGrowth();
      })
      .catch(function () {
        if (msg) {
          msg.className = "alert alert--error";
          msg.textContent =
            "Ошибка. Дата должна быть в будущем, сумма от 100 ₽. Проверь сервер.";
        }
      });
  }

  function onCreatePiggyBank() {
    var titleEl = document.getElementById("piggyNewTitle");
    var emojiEl = document.getElementById("piggyNewEmoji");
    var targetEl = document.getElementById("piggyNewTarget");
    var msg = document.getElementById("piggyCreateMsg");
    var title = titleEl ? titleEl.value.trim() : "";
    var emoji = emojiEl ? emojiEl.value.trim() : "";
    var rawTarget = targetEl ? String(targetEl.value).trim() : "";
    if (!title) {
      if (msg) {
        msg.className = "alert alert--error";
        msg.classList.remove("hidden");
        msg.textContent = "Укажи название.";
      }
      return;
    }
    var body = { title: title };
    if (emoji) body.emoji = emoji;
    if (rawTarget) {
      var target = parseInt(rawTarget, 10);
      if (!target || target < 100) {
        if (msg) {
          msg.className = "alert alert--error";
          msg.classList.remove("hidden");
          msg.textContent = "Сумма-ориентир от 100 ₽ или оставь поле пустым.";
        }
        return;
      }
      body.standalone_target = target;
    }
    var cid = getClientId();
    fetch(apiUrl("/api/client/" + encodeURIComponent(cid) + "/piggy-banks"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var err = new Error((j && j.message) || "Ошибка");
            throw err;
          }
          return j;
        });
      })
      .then(function () {
        if (msg) {
          msg.className = "alert alert--ok";
          msg.classList.remove("hidden");
          msg.textContent = "Копилка создана.";
        }
        if (titleEl) titleEl.value = "";
        if (emojiEl) emojiEl.value = "";
        if (targetEl) targetEl.value = "";
        renderPiggy();
        renderChildHome();
        loadParentGrowth();
      })
      .catch(function () {
        if (msg) {
          msg.className = "alert alert--error";
          msg.classList.remove("hidden");
          msg.textContent = "Не удалось создать. Проверь сервер.";
        }
      });
  }

  function onPiggyAttachGoal() {
    var hid = document.getElementById("piggyAttachPiggyId");
    var titleEl = document.getElementById("piggyAttachTitle");
    var targetEl = document.getElementById("piggyAttachTarget");
    var dateEl = document.getElementById("piggyAttachDeadline");
    var msg = document.getElementById("piggyAttachMsg");
    var card = document.getElementById("piggyAttachGoalCard");
    var piggyId = hid ? hid.value.trim() : "";
    var title = titleEl ? titleEl.value.trim() : "";
    var target = targetEl ? parseInt(targetEl.value, 10) : 0;
    var deadline = dateEl ? dateEl.value : "";
    if (!piggyId || !title || !target || !deadline) {
      if (msg) {
        msg.className = "alert alert--error";
        msg.classList.remove("hidden");
        msg.textContent = "Заполни все поля.";
      }
      return;
    }
    var cid = getClientId();
    fetch(
      apiUrl(
        "/api/client/" +
          encodeURIComponent(cid) +
          "/piggy-banks/" +
          encodeURIComponent(piggyId) +
          "/goal"
      ),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: title,
          target_amount: target,
          deadline: deadline,
        }),
      }
    )
      .then(function (r) {
        return r.json().then(function (j) {
          if (!r.ok) {
            var err = new Error((j && j.message) || "Ошибка");
            throw err;
          }
          return j;
        });
      })
      .then(function () {
        if (msg) {
          msg.className = "alert alert--ok";
          msg.classList.remove("hidden");
          msg.textContent = "Цель добавлена к копилке.";
        }
        if (card) card.classList.add("hidden");
        refreshGoalTab();
        renderPiggy();
        renderChildHome();
        loadParentGrowth();
      })
      .catch(function (err) {
        if (msg) {
          msg.className = "alert alert--error";
          msg.classList.remove("hidden");
          msg.textContent =
            (err && err.message) || "Не удалось сохранить. Проверь сервер.";
        }
      });
  }

  function onSendIdea() {
    var ta = document.getElementById("ideaText");
    var msg = document.getElementById("ideaMsg");
    var text = ta ? ta.value.trim() : "";
    if (!text) {
      if (msg) {
        msg.className = "alert alert--error";
        msg.textContent = "Напиши идею.";
      }
      return;
    }
    var cid = getClientId();
    fetch(apiUrl("/api/client/" + encodeURIComponent(cid) + "/savings-ideas"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: text }),
    })
      .then(function (r) {
        if (!r.ok) throw new Error();
        if (msg) {
          msg.className = "alert alert--ok";
          msg.textContent = "Отправлено маме на подтверждение.";
        }
        if (ta) ta.value = "";
        loadParentGrowth();
      })
      .catch(function () {
        if (msg) {
          msg.className = "alert alert--error";
          msg.textContent = "Не удалось отправить.";
        }
      });
  }

  function defaultState() {
    return {
      balance: MOCK.child.initialBalance,
      extraTransactions: [],
      settings: {
        dailyLimit: 500,
        cardBlocked: false,
        perTxnLimit: 300,
      },
    };
  }

  function loadState() {
    if (serverAppState === null) return defaultState();
    return mergeIncomingAppState(serverAppState);
  }

  function saveState(state) {
    serverAppState = clonePersisted(state);
    scheduleServerPush();
  }

  function loadSession() {
    return serverSession;
  }

  function saveSession(role) {
    serverSession = { role: role, at: Date.now() };
    serverSessionTouched = true;
    scheduleServerPush();
  }

  function clearSession() {
    serverSession = null;
    serverSessionTouched = true;
    scheduleServerPush();
  }

  function allTransactions(state) {
    return MOCK.transactions
      .concat(state.extraTransactions)
      .sort(function (a, b) {
        return new Date(b.date) - new Date(a.date);
      });
  }

  function isSavingsLikeTx(t) {
    if (t.kind === "savings_transfer") return true;
    var c = (t.category || "").toLowerCase();
    return c === "копилка" || c === "накопления" || c === "цель";
  }

  function spentToday(state) {
    var sum = 0;
    allTransactions(state).forEach(function (t) {
      if (
        t.amount < 0 &&
        isToday(t.date) &&
        !isSavingsLikeTx(t)
      )
        sum += Math.abs(t.amount);
    });
    return sum;
  }

  var els = {};

  function bindIds() {
    [
      "loginRoot",
      "appRoot",
      "roleChild",
      "roleParent",
      "pinInput",
      "loginBtn",
      "loginError",
      "childShell",
      "parentShell",
      "childTopName",
      "childTopRole",
      "childAvatar",
      "parentTopName",
      "parentTopRole",
      "parentAvatar",
      "btnLogoutChild",
      "btnLogoutParent",
      "childBlockedBanner",
      "parentBlockedBanner",
      "homeBalance",
      "homeRecent",
      "payAmount",
      "payMerchantHint",
      "paySubmit",
      "payMessage",
      "payMerchants",
      "historyList",
      "piggyList",
      "videoList",
      "gamesList",
      "parentStats",
      "parentTxList",
      "toggleBlocked",
      "inputDaily",
      "inputPerTxn",
      "btnSaveLimits",
      "limitsSaved",
      "modalBackdrop",
      "modalTitle",
      "modalBody",
      "modalCloseBtn",
      "simHub",
      "simActive",
      "simEmoji",
      "simTitle",
      "simSubtitle",
      "simBudgetValue",
      "simBudgetFill",
      "simBudgetWrap",
      "simScene",
      "simChoices",
      "simHint",
      "simHintText",
      "simContinue",
      "simEnd",
      "simEndBalance",
      "simEndCat",
      "simAgain",
      "simToHub",
      "simExit",
      "btnGoalContribBack",
      "btnGoalContribSubmit",
    ].forEach(function (id) {
      els[id] = document.getElementById(id);
    });
  }

  var state;
  var selectedRole = null;
  var selectedMerchant = null;
  var quizIndex = 0;
  var quizScore = 0;
  var simRuntime = null;
  var simPendingNext = null;

  /** Экран «Пополнить»: kind goal | piggy, id, title. */
  var goalContributeContext = { kind: "goal", id: "", title: "" };

  function selectRoleCard(role) {
    selectedRole = role;
    if (els.roleChild)
      els.roleChild.classList.toggle("is-selected", role === "child");
    if (els.roleParent)
      els.roleParent.classList.toggle("is-selected", role === "parent");
  }

  function showLogin() {
    if (els.loginRoot) els.loginRoot.classList.remove("hidden");
    if (els.appRoot) els.appRoot.classList.add("hidden");
  }

  function showApp() {
    if (els.loginRoot) els.loginRoot.classList.add("hidden");
    if (els.appRoot) els.appRoot.classList.remove("hidden");
  }

  function openModal(title, htmlOrNode, onClose) {
    els.modalTitle.textContent = title;
    els.modalBody.innerHTML = "";
    if (typeof htmlOrNode === "string")
      els.modalBody.innerHTML = htmlOrNode;
    else if (htmlOrNode) els.modalBody.appendChild(htmlOrNode);
    els.modalBackdrop.classList.add("is-open");
    els.modalCloseBtn.onclick = function () {
      closeModal();
      if (onClose) onClose();
    };
  }

  function closeModal() {
    els.modalBackdrop.classList.remove("is-open");
  }

  /** Какой пункт нижнего меню подсвечивать при открытом экране (оплата/история/копилка/цель → «Главная»). */
  function childTabBarIdForView(viewId) {
    if (
      viewId === "pay" ||
      viewId === "history" ||
      viewId === "savings" ||
      viewId === "goal" ||
      viewId === "goal-contribute"
    )
      return "home";
    return viewId;
  }

  function setChildView(id, tabBarActiveId) {
    var barId =
      tabBarActiveId === undefined ? id : tabBarActiveId;
    document.querySelectorAll("#childShell .view").forEach(function (v) {
      v.classList.toggle("is-active", v.getAttribute("data-view") === id);
    });
    document.querySelectorAll("#childShell .tab-bar button").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-tab") === barId);
    });
  }

  function afterChildShellViewChange(viewId) {
    if (viewId !== "savings") {
      var piggyAttachCard = document.getElementById("piggyAttachGoalCard");
      if (piggyAttachCard) piggyAttachCard.classList.add("hidden");
    }
    if (viewId === "home") renderChildHome();
    if (viewId === "history") {
      state = loadState();
      renderHistory();
      var now = Date.now();
      if (now - lastHistoryTrackTs > 8000) {
        lastHistoryTrackTs = now;
        postTrack("history_view");
      }
    }
    if (viewId === "savings") renderPiggy();
    if (viewId === "goal") refreshGoalTab();
    if (viewId === "goal-contribute") syncGoalContributeScreen();
    if (viewId === "learn") renderVideos();
    if (viewId === "play") renderGames();
    if (viewId === "sim") simEnterTab();
  }

  function navigateChildFromHome(viewId) {
    setChildView(viewId, childTabBarIdForView(viewId));
    afterChildShellViewChange(viewId);
  }

  function setParentView(id) {
    document.querySelectorAll("#parentShell .view").forEach(function (v) {
      v.classList.toggle("is-active", v.getAttribute("data-view") === id);
    });
    document.querySelectorAll("#parentShell .tab-bar button").forEach(function (b) {
      b.classList.toggle("is-active", b.getAttribute("data-tab") === id);
    });
  }

  function renderChildHome() {
    state = loadState();
    var blocked = state.settings.cardBlocked;
    if (els.childBlockedBanner)
      els.childBlockedBanner.classList.toggle("hidden", !blocked);
    if (els.homeBalance) els.homeBalance.textContent = formatMoney(state.balance);

    var txs = allTransactions(state).slice(0, 4);
    if (els.homeRecent) {
      els.homeRecent.innerHTML = txs
        .map(function (t) {
          var cls =
            t.amount < 0 ? "tx-item__amount--neg" : "tx-item__amount--pos";
          var sign = t.amount < 0 ? "−" : "+";
          return (
            '<li class="tx-item">' +
            '<div><div class="tx-item__title">' +
            escapeHtml(t.title) +
            '</div><div class="tx-item__meta">' +
            escapeHtml(formatDateTime(t.date)) +
            " · " +
            escapeHtml(t.category) +
            "</div></div>" +
            '<span class="tx-item__amount ' +
            cls +
            '">' +
            sign +
            formatMoney(Math.abs(t.amount)).replace(" ₽", "") +
            " ₽</span></li>"
          );
        })
        .join("");
    }
    renderHomeSavingsPreview();
  }

  function renderHomeSavingsPreview() {
    var goalEl = document.getElementById("homeGoalPreview");
    var piggyEl = document.getElementById("homePiggyPreview");
    if (!goalEl && !piggyEl) return;
    var cid = getClientId();
    if (!cid) return;
    if (goalEl) goalEl.innerHTML = '<p class="muted" style="margin:0">Загрузка…</p>';
    if (piggyEl) piggyEl.innerHTML = "";
    Promise.all([
      fetch(apiUrl("/api/client/" + encodeURIComponent(cid) + "/goals")).then(
        function (r) {
          if (!r.ok) throw new Error("goals " + r.status);
          return r.json();
        }
      ),
      fetch(
        apiUrl("/api/client/" + encodeURIComponent(cid) + "/piggy-banks")
      ).then(function (r) {
        if (!r.ok) throw new Error("piggy " + r.status);
        return r.json();
      }),
    ])
      .then(function (pair) {
        var goals = (pair[0] && pair[0].goals) || [];
        var banks = (pair[1] && pair[1].banks) || [];
        var activeList = goals.filter(function (g) {
          return g.active;
        });
        var emptyForUser =
          !activeList.length && (!banks || !banks.length);
        if (emptyForUser) {
          var emptyMsg =
            '<p class="muted" style="margin:0">Пока нет целей и копилок. Создай копилку на вкладке «Копилки» или цель на вкладке «Цель».</p>';
          if (goalEl) goalEl.innerHTML = emptyMsg;
          if (piggyEl) piggyEl.innerHTML = emptyMsg;
          return;
        }
        if (goalEl) {
          if (!activeList.length) {
            goalEl.innerHTML =
              '<p class="muted" style="margin:0">Заведи цель — можно несколько сразу.</p>';
          } else {
            goalEl.innerHTML = activeList
              .slice(0, 4)
              .map(function (active) {
                var pct = Math.min(
                  100,
                  Math.round((active.saved_total / active.target_amount) * 100)
                );
            return (
              '<div class="home-goal-row home-goal-row--list">' +
                  '<span class="home-goal-emoji" aria-hidden="true">' +
                  piggyTierEmoji(pct) +
                  "</span>" +
                  '<div class="home-goal-meta">' +
                  "<strong>" +
                  escapeHtml(active.title) +
                  "</strong>" +
                  '<div class="piggy-bar" style="margin:0.35rem 0"><div class="piggy-bar__fill" style="width:' +
                  pct +
                  '%"></div></div>' +
                  '<p class="muted" style="margin:0;font-size:0.82rem">' +
                  formatMoney(active.saved_total) +
                  " из " +
                  formatMoney(active.target_amount) +
                  " · " +
                  pct +
                  "%</p></div></div>"
                );
              })
              .join("");
            if (activeList.length > 4) {
              goalEl.innerHTML +=
                '<p class="muted" style="margin:0.5rem 0 0;font-size:0.82rem">Ещё целей: ' +
                (activeList.length - 4) +
                " — смотри вкладку «Цель».</p>";
            }
          }
        }
        if (piggyEl) {
          if (!banks.length) {
            piggyEl.innerHTML =
              '<p class="muted" style="margin:0">Создай копилку на вкладке «Копилки» или цель на вкладке «Цель».</p>';
          } else {
            var totalSaved = banks.reduce(function (s, b) {
              return s + b.saved_total;
            }, 0);
            piggyEl.innerHTML =
              '<p class="home-piggy-total"><span aria-hidden="true">🐷</span> Всего на копилках: <strong>' +
              formatMoney(totalSaved) +
              "</strong></p>" +
              '<ul class="home-piggy-list">' +
              banks
                .slice(0, 3)
                .map(function (b) {
                  var cap =
                    b.goal_id != null
                      ? b.target_amount
                      : b.standalone_target != null
                        ? b.standalone_target
                        : null;
                  var bpc =
                    cap != null && cap > 0
                      ? Math.min(100, Math.round((b.saved_total / cap) * 100))
                      : 0;
                  var showEmoji =
                    cap != null && cap > 0
                      ? piggyTierEmoji(bpc)
                      : b.emoji;
                  return (
                    '<li class="home-piggy-item">' +
                    "<span>" +
                    escapeHtml(showEmoji) +
                    " " +
                    escapeHtml(b.title) +
                    "</span>" +
                    '<span class="home-piggy-item__amount">' +
                    formatMoney(b.saved_total) +
                    "</span></li>"
                  );
                })
                .join("") +
              (banks.length > 3
                ? '<li class="home-piggy-item home-piggy-item--more muted">…</li>'
                : "") +
              "</ul>";
          }
        }
      })
      .catch(function () {
        var errMsg =
          '<p class="muted" style="margin:0">Не удалось связаться с сервером. Запусти приложение (например, порт 5001) и обнови страницу.</p>';
        if (goalEl) goalEl.innerHTML = errMsg;
        if (piggyEl) piggyEl.innerHTML = "";
      });
  }

  function exitGoalContributeScreen() {
    setChildView("goal", childTabBarIdForView("goal"));
    afterChildShellViewChange("goal");
  }

  function syncGoalContributeScreen() {
    var headingEl = document.getElementById("goalContribSectionHeading");
    if (headingEl) {
      headingEl.textContent =
        goalContributeContext.kind === "piggy"
          ? "Пополнить копилку"
          : "Пополнить цель";
    }
    var titleEl = document.getElementById("goalContribScreenTitle");
    var amtEl = document.getElementById("goalContribScreenAmount");
    var msgEl = document.getElementById("goalContribScreenMsg");
    if (titleEl) titleEl.textContent = goalContributeContext.title || "";
    if (amtEl) amtEl.value = "";
    if (msgEl) {
      msgEl.className = "alert hidden";
      msgEl.textContent = "";
    }
    if (amtEl) {
      setTimeout(function () {
        amtEl.focus();
      }, 0);
    }
  }

  function openGoalContributeScreen(goalId, goalTitle) {
    goalContributeContext = {
      kind: "goal",
      id: goalId || "",
      title: goalTitle || "",
    };
    setChildView("goal-contribute", childTabBarIdForView("goal-contribute"));
    afterChildShellViewChange("goal-contribute");
  }

  function openPiggyContributeScreen(piggyId, piggyTitle) {
    goalContributeContext = {
      kind: "piggy",
      id: piggyId || "",
      title: piggyTitle || "",
    };
    setChildView("goal-contribute", childTabBarIdForView("goal-contribute"));
    afterChildShellViewChange("goal-contribute");
  }

  function bindGoalContribMountOnce() {
    var mount = document.getElementById("goalActiveMount");
    if (!mount || mount.dataset.contribBound) return;
    mount.dataset.contribBound = "1";
    mount.addEventListener("click", function (e) {
      var btn = e.target.closest("[data-goal-contrib]");
      if (!btn || !mount.contains(btn)) return;
      e.preventDefault();
      openGoalContributeScreen(
        btn.getAttribute("data-goal-contrib"),
        btn.getAttribute("data-goal-title") || ""
      );
    });
  }

  function bindPiggyListOnce() {
    var list = document.getElementById("piggyList");
    if (!list || list.dataset.piggyBound) return;
    list.dataset.piggyBound = "1";
    list.addEventListener("click", function (e) {
      var cbtn = e.target.closest("[data-piggy-contrib]");
      if (cbtn && list.contains(cbtn)) {
        e.preventDefault();
        openPiggyContributeScreen(
          cbtn.getAttribute("data-piggy-contrib"),
          cbtn.getAttribute("data-piggy-title") || ""
        );
        return;
      }
      var gbtn = e.target.closest("[data-piggy-add-goal]");
      if (gbtn && list.contains(gbtn)) {
        e.preventDefault();
        showPiggyAttachGoalForm(
          gbtn.getAttribute("data-piggy-add-goal"),
          gbtn.getAttribute("data-piggy-title") || ""
        );
      }
    });
  }

  function showPiggyAttachGoalForm(piggyId, piggyTitle) {
    var card = document.getElementById("piggyAttachGoalCard");
    var hid = document.getElementById("piggyAttachPiggyId");
    var lab = document.getElementById("piggyAttachPiggyLabel");
    var msg = document.getElementById("piggyAttachMsg");
    if (!card || !hid) return;
    hid.value = piggyId || "";
    if (lab)
      lab.textContent =
        "Копилка: " + (piggyTitle || "без названия");
    if (msg) {
      msg.className = "alert hidden";
      msg.textContent = "";
    }
    var t = document.getElementById("piggyAttachTitle");
    var ta = document.getElementById("piggyAttachTarget");
    var d = document.getElementById("piggyAttachDeadline");
    if (t) t.value = "";
    if (ta) ta.value = "";
    if (d) {
      var tmr = new Date();
      tmr.setDate(tmr.getDate() + 1);
      d.min = tmr.toISOString().slice(0, 10);
      var endD = new Date();
      endD.setDate(endD.getDate() + 56);
      d.value = endD.toISOString().slice(0, 10);
    }
    card.classList.remove("hidden");
    card.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }

  function renderPayMerchants() {
    if (!els.payMerchants) return;
    els.payMerchants.innerHTML = MOCK.merchants
      .map(function (m) {
        return (
          '<button type="button" class="merchant-btn" data-id="' +
          m.id +
          '">' +
          '<span class="merchant-btn__emoji">' +
          m.emoji +
          "</span>" +
          '<span class="merchant-btn__info"><strong>' +
          escapeHtml(m.title) +
          "</strong><span>" +
          formatMoney(m.suggestedAmount) +
          "</span></span></button>"
        );
      })
      .join("");

    els.payMerchants.querySelectorAll(".merchant-btn").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-id");
        var m = MOCK.merchants.find(function (x) {
          return x.id === id;
        });
        selectedMerchant = m;
        els.payMerchants.querySelectorAll(".merchant-btn").forEach(function (b) {
          b.style.outline = "";
        });
        btn.style.outline = "2px solid var(--accent)";
        if (els.payAmount) els.payAmount.value = String(m.suggestedAmount);
        if (els.payMerchantHint)
          els.payMerchantHint.textContent = "Оплата: " + m.title;
      });
    });
  }

  function renderHistory() {
    if (!els.historyList) return;
    var txs = allTransactions(state);
    els.historyList.innerHTML = txs
      .map(function (t) {
        var cls =
          t.amount < 0 ? "tx-item__amount--neg" : "tx-item__amount--pos";
        var sign = t.amount < 0 ? "−" : "+";
        return (
          '<li class="tx-item">' +
          '<div><div class="tx-item__title">' +
          escapeHtml(t.title) +
          '</div><div class="tx-item__meta">' +
          escapeHtml(formatDateTime(t.date)) +
          " · " +
          escapeHtml(t.category) +
          "</div></div>" +
          '<span class="tx-item__amount ' +
          cls +
          '">' +
          sign +
          formatMoney(Math.abs(t.amount)).replace(" ₽", "") +
          " ₽</span></li>"
        );
      })
      .join("");
  }

  function renderPiggy() {
    if (!els.piggyList) return;
    bindPiggyListOnce();
    var cid = getClientId();
    if (!cid) {
      els.piggyList.innerHTML =
        '<p class="muted">Нет идентификатора клиента.</p>';
      return;
    }
    els.piggyList.innerHTML =
      '<p class="muted" style="margin:0">Загрузка копилок…</p>';
    fetch(apiUrl("/api/client/" + encodeURIComponent(cid) + "/piggy-banks"))
      .then(function (r) {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then(function (d) {
        var banks = (d && d.banks) || [];
        if (!banks.length) {
          els.piggyList.innerHTML =
            '<p class="muted">Пока нет копилок. Создай копилку выше или цель на вкладке «Цель».</p>';
          return;
        }
        els.piggyList.innerHTML = banks
          .map(function (p) {
            var hasGoal = p.goal_id != null;
            var cap = hasGoal
              ? p.target_amount
              : p.standalone_target != null
                ? p.standalone_target
                : null;
            var pct =
              cap != null && cap > 0
                ? Math.min(100, Math.round((p.saved_total / cap) * 100))
                : 0;
            var badge = hasGoal
              ? p.active
                ? '<span class="badge-tiny">Активная цель</span>'
                : '<span class="badge-tiny badge-tiny--muted">Архив</span>'
              : '<span class="badge-tiny">Без цели</span>';
            var meta;
            if (hasGoal) {
              meta =
                formatMoney(p.saved_total) +
                " из " +
                formatMoney(p.target_amount) +
                " · до " +
                escapeHtml(String(p.deadline).slice(0, 10));
            } else if (cap != null) {
              meta =
                formatMoney(p.saved_total) +
                " из " +
                formatMoney(cap) +
                " · без даты цели";
            } else {
              meta = "Накоплено " + formatMoney(p.saved_total) + " · цель не задана";
            }
            var actions = hasGoal
              ? ""
              : '<div class="piggy-actions" style="margin-top:0.5rem;display:flex;flex-wrap:wrap;gap:0.35rem">' +
                '<button type="button" class="btn btn-primary btn-sm" data-piggy-contrib="' +
                attrEscape(p.id) +
                '" data-piggy-title="' +
                attrEscape(p.title) +
                '">Внести</button>' +
                '<button type="button" class="btn btn-ghost btn-sm" data-piggy-add-goal="' +
                attrEscape(p.id) +
                '" data-piggy-title="' +
                attrEscape(p.title) +
                '">Добавить цель</button>' +
                "</div>";
            var rowEmoji =
              cap != null && cap > 0 ? piggyTierEmoji(pct) : p.emoji;
            return (
              '<div class="piggy-item">' +
              '<div class="piggy-head"><span>' +
              escapeHtml(rowEmoji) +
              " " +
              escapeHtml(p.title) +
              "</span><span>" +
              (cap != null && cap > 0 ? pct + "%" : "—") +
              "</span></div>" +
              badge +
              (cap != null && cap > 0
                ? '<div class="piggy-bar"><div class="piggy-bar__fill" style="width:' +
                  pct +
                  '%"></div></div>'
                : '<div class="piggy-bar"><div class="piggy-bar__fill" style="width:0%"></div></div>') +
              '<p class="muted" style="margin:0.35rem 0 0">' +
              meta +
              "</p>" +
              actions +
              "</div>"
            );
          })
          .join("");
      })
      .catch(function () {
        els.piggyList.innerHTML =
          '<p class="muted">Не удалось загрузить копилки. Проверь сервер.</p>';
      });
  }

  function renderVideos() {
    if (!els.videoList) return;
    els.videoList.innerHTML = MOCK.videos
      .map(function (v) {
        var badge = v.watched
          ? '<span class="badge-tiny">Просмотрено</span>'
          : '<span class="badge-tiny badge-tiny--muted">Новое</span>';
        return (
          '<div class="video-row">' +
          '<div class="video-row__thumb">' +
          v.emoji +
          "</div>" +
          '<div class="video-row__body"><div class="video-row__title">' +
          escapeHtml(v.title) +
          '</div><div class="video-row__dur">' +
          escapeHtml(v.duration) +
          " · демо</div></div>" +
          badge +
          "</div>"
        );
      })
      .join("");
  }

  function renderGames() {
    if (!els.gamesList) return;
    els.gamesList.innerHTML = MOCK.games
      .map(function (g) {
        var label =
          g.type === "soon"
            ? '<button type="button" class="btn btn-ghost btn-sm" disabled>Скоро</button>'
            : '<button type="button" class="btn btn-primary btn-sm" data-game="' +
              escapeHtml(g.id) +
              '">Играть</button>';
        return (
          '<div class="game-card">' +
          '<div class="game-card__icon">' +
          g.emoji +
          "</div>" +
          "<div><strong>" +
          escapeHtml(g.title) +
          "</strong><p class=\"muted\" style=\"margin:0.2rem 0 0;font-size:0.85rem\">" +
          escapeHtml(g.description) +
          "</p></div>" +
          label +
          "</div>"
        );
      })
      .join("");

    els.gamesList.querySelectorAll("[data-game]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var id = btn.getAttribute("data-game");
        var g = MOCK.games.find(function (x) {
          return x.id === id;
        });
        if (!g) return;
        if (g.type === "quiz") startQuiz();
        if (g.type === "mental") startMental();
      });
    });
  }

  function simEndSummary(remain, start) {
    if (remain < 0) {
      return (
        "Бюджет ушёл в минус — в жизни так лучше не доводить: прикидывай траты заранее. Здесь это просто безопасный урок."
      );
    }
    var ratio = start > 0 ? remain / start : 0;
    if (ratio >= 0.55) {
      return (
        "Сильный финиш: у тебя осталась большая часть бюджета или ты осознанно решил(а), куда пойдут деньги. Мурр!"
      );
    }
    if (ratio >= 0.25) {
      return (
        "Неплохой запас. Подумай, какие выборы помогли оставить деньги — такие приёмы работают и в реальных покупках."
      );
    }
    if (remain === 0) {
      return (
        "Ровно в ноль: в жизни полезно иногда оставлять крошечный запас «на неожиданное». Попробуй сценарий ещё раз с другими вариантами."
      );
    }
    return (
      "Осталось совсем чуть-чуть или ты потратил(а) почти всё — тоже опыт. Загляни на шаги назад: что можно сделать иначе в следующий раз?"
    );
  }

  function updateSimBudgetUI() {
    if (!simRuntime || !els.simBudgetValue) return;
    els.simBudgetValue.textContent = formatMoney(simRuntime.budget);
    var start = simRuntime.startBudget;
    var pct =
      start <= 0
        ? 0
        : Math.max(0, Math.min(100, (simRuntime.budget / start) * 100));
    if (els.simBudgetFill) els.simBudgetFill.style.width = pct + "%";
    if (els.simBudgetWrap) {
      els.simBudgetWrap.classList.toggle("sim-budget--low", pct > 0 && pct < 22);
      els.simBudgetWrap.classList.toggle(
        "sim-budget--empty",
        simRuntime.budget <= 0
      );
    }
  }

  function resetSimLayoutForPlay() {
    if (els.simEnd) els.simEnd.classList.add("hidden");
    var card = document.querySelector("#simActive .sim-scene-card");
    if (card) card.classList.remove("hidden");
    if (els.simHint) els.simHint.classList.add("hidden");
    if (els.simContinue) els.simContinue.classList.add("hidden");
    simPendingNext = null;
  }

  function renderSimHub() {
    simRuntime = null;
    simPendingNext = null;
    if (!els.simHub) return;
    var list = MOCK.simulators || [];
    if (els.simActive) els.simActive.classList.add("hidden");
    els.simHub.classList.remove("hidden");
    els.simHub.innerHTML = list
      .map(function (s) {
        return (
          '<button type="button" class="sim-card" data-sim-id="' +
          escapeHtml(s.id) +
          '"><span class="sim-card__emoji" aria-hidden="true">' +
          s.emoji +
          '</span><span class="sim-card__body"><strong>' +
          escapeHtml(s.title) +
          "</strong><p>" +
          escapeHtml(s.subtitle) +
          "</p></span></button>"
        );
      })
      .join("");
    els.simHub.querySelectorAll("[data-sim-id]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        startSimulator(btn.getAttribute("data-sim-id"));
      });
    });
  }

  function startSimulator(scenarioId) {
    var list = MOCK.simulators || [];
    var sc = list.find(function (x) {
      return x.id === scenarioId;
    });
    if (!sc || !sc.steps || !sc.steps.length) return;
    simRuntime = {
      scenario: sc,
      stepIndex: 0,
      budget: sc.startBudget,
      startBudget: sc.startBudget,
    };
    simPendingNext = null;
    if (els.simHub) els.simHub.classList.add("hidden");
    if (els.simActive) els.simActive.classList.remove("hidden");
    if (els.simEmoji) els.simEmoji.textContent = sc.emoji || "🎭";
    if (els.simTitle) els.simTitle.textContent = sc.title;
    if (els.simSubtitle) els.simSubtitle.textContent = sc.subtitle || "";
    resetSimLayoutForPlay();
    updateSimBudgetUI();
    renderSimStep();
  }

  function renderSimStep() {
    if (!simRuntime || !els.simScene || !els.simChoices) return;
    var step = simRuntime.scenario.steps[simRuntime.stepIndex];
    if (!step) {
      renderSimEnd();
      return;
    }
    els.simScene.textContent = step.text;
    els.simChoices.innerHTML = "";
    step.choices.forEach(function (ch, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "sim-choice";
      b.textContent = ch.label;
      b.addEventListener("click", function () {
        onSimChoice(i);
      });
      els.simChoices.appendChild(b);
    });
  }

  function onSimChoice(choiceIndex) {
    if (!simRuntime || simPendingNext !== null) return;
    var step = simRuntime.scenario.steps[simRuntime.stepIndex];
    if (!step || !step.choices[choiceIndex]) return;
    var c = step.choices[choiceIndex];
    simRuntime.budget += c.delta;
    simPendingNext = c.next;
    els.simChoices.innerHTML = "";
    if (els.simHintText) els.simHintText.textContent = c.hint;
    if (els.simHint) els.simHint.classList.remove("hidden");
    if (els.simContinue) els.simContinue.classList.remove("hidden");
    updateSimBudgetUI();
  }

  function onSimContinue() {
    if (simPendingNext === null || !simRuntime) return;
    var nxt = simPendingNext;
    simPendingNext = null;
    if (els.simHint) els.simHint.classList.add("hidden");
    if (els.simContinue) els.simContinue.classList.add("hidden");
    if (nxt === "end") {
      renderSimEnd();
      return;
    }
    if (typeof nxt === "number") {
      simRuntime.stepIndex = nxt;
      if (simRuntime.stepIndex >= simRuntime.scenario.steps.length) {
        renderSimEnd();
        return;
      }
      renderSimStep();
    }
  }

  function renderSimEnd() {
    if (!simRuntime || !els.simEnd) return;
    var card = document.querySelector("#simActive .sim-scene-card");
    if (card) card.classList.add("hidden");
    els.simEnd.classList.remove("hidden");
    if (els.simEndBalance)
      els.simEndBalance.textContent = formatMoney(simRuntime.budget);
    if (els.simEndCat)
      els.simEndCat.textContent = simEndSummary(
        simRuntime.budget,
        simRuntime.startBudget
      );
  }

  function exitSimulatorToHub() {
    renderSimHub();
  }

  /** Не сбрасывать сценарий, если ребёнок вернулся на вкладку посреди квеста. */
  function simEnterTab() {
    if (simRuntime === null) renderSimHub();
  }

  function restartCurrentSimulator() {
    if (!simRuntime || !simRuntime.scenario) return;
    startSimulator(simRuntime.scenario.id);
  }

  function startQuiz() {
    quizIndex = 0;
    quizScore = 0;
    showQuizQuestion();
  }

  function showQuizQuestion() {
    var qs = MOCK.quizQuestions;
    if (quizIndex >= qs.length) {
      openModal(
        "Готово!",
        "<p class=\"muted\">Ты ответил правильно на <strong>" +
          quizScore +
          "</strong> из " +
          qs.length +
          ".</p><p>Так держать — финансовая грамотность приходит с практикой.</p>",
        function () {}
      );
      return;
    }
    var q = qs[quizIndex];
    var wrap = document.createElement("div");
    var p = document.createElement("p");
    p.style.fontWeight = "800";
    p.style.marginBottom = "1rem";
    p.textContent =
      "Вопрос " + (quizIndex + 1) + " из " + qs.length + ": " + q.q;
    wrap.appendChild(p);
    var opts = document.createElement("div");
    opts.className = "quiz-options";
    q.options.forEach(function (opt, i) {
      var b = document.createElement("button");
      b.type = "button";
      b.textContent = opt;
      b.addEventListener("click", function () {
        opts.querySelectorAll("button").forEach(function (x) {
          x.disabled = true;
        });
        if (i === q.correct) {
          b.classList.add("is-correct");
          quizScore++;
        } else {
          b.classList.add("is-wrong");
          var c = q.options[q.correct];
          Array.prototype.forEach.call(opts.children, function (btn, j) {
            if (j === q.correct) btn.classList.add("is-correct");
          });
        }
        setTimeout(function () {
          closeModal();
          quizIndex++;
          showQuizQuestion();
        }, 900);
      });
      opts.appendChild(b);
    });
    wrap.appendChild(opts);
    openModal("Квиз «Умные траты»", wrap);
  }

  function startMental() {
    var a = Math.floor(Math.random() * 40) + 10;
    var b = Math.floor(Math.random() * 40) + 5;
    var ans = a + b;
    var wrap = document.createElement("div");
    var p = document.createElement("p");
    p.style.fontWeight = "800";
    p.textContent = "Сколько будет " + a + " + " + b + "?";
    wrap.appendChild(p);
    var inp = document.createElement("input");
    inp.type = "number";
    inp.inputMode = "numeric";
    inp.style.marginTop = "0.75rem";
    inp.style.width = "100%";
    inp.style.padding = "0.75rem";
    inp.style.borderRadius = "12px";
    inp.style.border = "2px solid rgba(45,157,106,0.2)";
    inp.style.fontFamily = "inherit";
    inp.style.fontSize = "1.1rem";
    inp.style.fontWeight = "700";
    wrap.appendChild(inp);
    var msg = document.createElement("p");
    msg.className = "muted";
    msg.style.marginTop = "0.75rem";
    wrap.appendChild(msg);
    var go = document.createElement("button");
    go.type = "button";
    go.className = "btn btn-primary";
    go.style.marginTop = "0.75rem";
    go.style.width = "100%";
    go.textContent = "Проверить";
    go.addEventListener("click", function () {
      var v = parseInt(inp.value, 10);
      if (v === ans) {
        msg.textContent = "Верно! Молодец.";
        msg.className = "alert alert--ok";
        msg.style.marginTop = "0.75rem";
      } else {
        msg.textContent = "Почти. Правильный ответ: " + ans + ".";
        msg.className = "alert alert--error";
        msg.style.marginTop = "0.75rem";
      }
    });
    wrap.appendChild(go);
    openModal("Счёт в уме", wrap);
  }

  function renderParent() {
    state = loadState();
    var spent = spentToday(state);
    var rem = Math.max(0, state.settings.dailyLimit - spent);
    var blocked = state.settings.cardBlocked;

    if (els.parentBlockedBanner)
      els.parentBlockedBanner.classList.toggle("hidden", !blocked);

    if (els.parentStats) {
      els.parentStats.innerHTML =
        '<div class="parent-stat"><strong>' +
        formatMoney(state.balance) +
        '</strong><span>Баланс ' +
        escapeHtml(MOCK.child.name) +
        "</span></div>" +
        '<div class="parent-stat"><strong>' +
        formatMoney(rem) +
        '</strong><span>Остаток на сегодня</span></div>' +
        '<div class="parent-stat"><strong>' +
        formatMoney(state.settings.dailyLimit) +
        '</strong><span>Дневной лимит</span></div>' +
        '<div class="parent-stat"><strong>' +
        formatMoney(spent) +
        '</strong><span>Потрачено сегодня</span></div>';
    }

    if (els.parentTxList) {
      var txs = allTransactions(state);
      els.parentTxList.innerHTML = txs
        .map(function (t) {
          var cls =
            t.amount < 0 ? "tx-item__amount--neg" : "tx-item__amount--pos";
          var sign = t.amount < 0 ? "−" : "+";
          return (
            '<li class="tx-item">' +
            '<div><div class="tx-item__title">' +
            escapeHtml(t.title) +
            '</div><div class="tx-item__meta">' +
            escapeHtml(formatDateTime(t.date)) +
            "</div></div>" +
            '<span class="tx-item__amount ' +
            cls +
            '">' +
            sign +
            formatMoney(Math.abs(t.amount)).replace(" ₽", "") +
            " ₽</span></li>"
          );
        })
        .join("");
    }

    if (els.toggleBlocked) els.toggleBlocked.checked = blocked;
    if (els.inputDaily) els.inputDaily.value = String(state.settings.dailyLimit);
    if (els.inputPerTxn)
      els.inputPerTxn.value = String(state.settings.perTxnLimit);
    if (els.limitsSaved) els.limitsSaved.classList.add("hidden");
    loadParentGrowth();
  }

  function tryPay() {
    state = loadState();
    els.payMessage.textContent = "";
    els.payMessage.className = "alert hidden";

    if (state.settings.cardBlocked) {
      els.payMessage.textContent = "Карта заблокирована родителем.";
      els.payMessage.className = "alert alert--error";
      return;
    }
    if (!selectedMerchant) {
      els.payMessage.textContent = "Выбери магазин или место оплаты.";
      els.payMessage.className = "alert alert--error";
      return;
    }
    var amount = parseInt(els.payAmount.value, 10);
    if (!amount || amount < 1) {
      els.payMessage.textContent = "Введи сумму больше нуля.";
      els.payMessage.className = "alert alert--error";
      return;
    }
    if (amount > state.settings.perTxnLimit) {
      els.payMessage.textContent =
        "Превышен лимит на одну покупку: " +
        formatMoney(state.settings.perTxnLimit) +
        ".";
      els.payMessage.className = "alert alert--error";
      return;
    }
    var spent = spentToday(state);
    if (spent + amount > state.settings.dailyLimit) {
      els.payMessage.textContent =
        "Превышен дневной лимит. Осталось сегодня: " +
        formatMoney(Math.max(0, state.settings.dailyLimit - spent)) +
        ".";
      els.payMessage.className = "alert alert--error";
      return;
    }
    if (amount > state.balance) {
      els.payMessage.textContent = "Недостаточно средств на карте.";
      els.payMessage.className = "alert alert--error";
      return;
    }

    state.balance -= amount;
    state.extraTransactions.unshift({
      id: "tx-" + Date.now(),
      date: new Date().toISOString(),
      title: selectedMerchant.title,
      amount: -amount,
      category: "Покупка",
    });
    saveState(state);
    els.payMessage.textContent = "Оплата прошла успешно!";
    els.payMessage.className = "alert alert--ok";
    renderChildHome();
    renderHistory();
    if (loadSession() && loadSession().role === "parent") renderParent();
    loadParentGrowth();
  }

  function login() {
    if (els.loginError) {
      els.loginError.textContent = "";
      els.loginError.className = "alert hidden";
    }
    if (!selectedRole) {
      if (els.loginError) {
        els.loginError.textContent =
          "Выбери, кто входит: ребёнок или родитель.";
        els.loginError.className = "alert alert--error";
      }
      return;
    }
    saveSession(selectedRole);
    showApp();
    if (selectedRole === "child") {
      els.childShell.classList.remove("hidden");
      els.parentShell.classList.add("hidden");
      els.childTopName.textContent = MOCK.child.name;
      els.childTopRole.textContent = "Детский аккаунт";
      els.childAvatar.textContent = MOCK.child.avatar;
      setChildView("home");
      afterChildShellViewChange("home");
      renderPayMerchants();
      renderHistory();
      renderPiggy();
      renderVideos();
      renderGames();
      renderSimHub();
      refreshGoalTab();
    } else {
      els.parentShell.classList.remove("hidden");
      els.childShell.classList.add("hidden");
      els.parentTopName.textContent = MOCK.parent.name;
      els.parentTopRole.textContent = "Родитель · " + MOCK.parent.childName;
      els.parentAvatar.textContent = MOCK.parent.avatar;
      setParentView("overview");
      renderParent();
      loadParentGrowth();
    }
  }

  function logout() {
    clearSession();
    showLogin();
    selectedRole = null;
    selectRoleCard(null);
    if (els.pinInput) els.pinInput.value = "";
  }

  function init() {
    bindIds();
    state = loadState();

    if (els.roleChild)
      els.roleChild.addEventListener("click", function () {
        selectRoleCard("child");
      });
    if (els.roleParent)
      els.roleParent.addEventListener("click", function () {
        selectRoleCard("parent");
      });

    if (els.loginBtn)
      els.loginBtn.addEventListener("click", function () {
        login();
      });
    if (els.pinInput)
      els.pinInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter") login();
      });

    if (els.btnLogoutChild)
      els.btnLogoutChild.addEventListener("click", logout);
    if (els.btnLogoutParent)
      els.btnLogoutParent.addEventListener("click", logout);

    document.querySelectorAll("#childShell .tab-bar button").forEach(function (b) {
      b.addEventListener("click", function () {
        var tab = b.getAttribute("data-tab");
        setChildView(tab);
        afterChildShellViewChange(tab);
      });
    });

    if (els.childShell)
      els.childShell.addEventListener("click", function (e) {
        var back = e.target.closest("[data-back-home]");
        if (!back) return;
        e.preventDefault();
        if (typeof window.zernyshkoNavigateChild === "function")
          window.zernyshkoNavigateChild("home");
      });

    if (els.simContinue)
      els.simContinue.addEventListener("click", onSimContinue);
    if (els.simExit) els.simExit.addEventListener("click", exitSimulatorToHub);
    if (els.simAgain) els.simAgain.addEventListener("click", restartCurrentSimulator);
    if (els.simToHub) els.simToHub.addEventListener("click", exitSimulatorToHub);

    var btnGoalCreate = document.getElementById("btnGoalCreate");
    if (btnGoalCreate) btnGoalCreate.addEventListener("click", onCreateGoal);
    var btnPiggyCreate = document.getElementById("btnPiggyCreate");
    if (btnPiggyCreate) btnPiggyCreate.addEventListener("click", onCreatePiggyBank);
    var btnPiggyAttachGoal = document.getElementById("btnPiggyAttachGoal");
    if (btnPiggyAttachGoal)
      btnPiggyAttachGoal.addEventListener("click", onPiggyAttachGoal);
    var btnIdeaSend = document.getElementById("btnIdeaSend");
    if (btnIdeaSend) btnIdeaSend.addEventListener("click", onSendIdea);

    bindGoalContribMountOnce();
    bindPiggyListOnce();

    if (els.btnGoalContribBack)
      els.btnGoalContribBack.addEventListener("click", exitGoalContributeScreen);
    if (els.btnGoalContribSubmit)
      els.btnGoalContribSubmit.addEventListener("click", function () {
        var amtEl = document.getElementById("goalContribScreenAmount");
        var msgEl = document.getElementById("goalContribScreenMsg");
        var amt = amtEl ? parseInt(amtEl.value, 10) : 0;
        submitContribute(amt, msgEl);
      });
    var gca = document.getElementById("goalContribScreenAmount");
    if (gca)
      gca.addEventListener("keydown", function (e) {
        if (e.key === "Enter") {
          e.preventDefault();
          if (els.btnGoalContribSubmit) els.btnGoalContribSubmit.click();
        }
      });

    var gdeadline = document.getElementById("goalFormDeadline");
    if (gdeadline) {
      var tmr = new Date();
      tmr.setDate(tmr.getDate() + 1);
      gdeadline.min = tmr.toISOString().slice(0, 10);
      var endD = new Date();
      endD.setDate(endD.getDate() + 56);
      if (!gdeadline.value) gdeadline.value = endD.toISOString().slice(0, 10);
    }

    document.querySelectorAll("#parentShell .tab-bar button").forEach(function (b) {
      b.addEventListener("click", function () {
        var tab = b.getAttribute("data-tab");
        setParentView(tab);
        if (tab === "overview" || tab === "activity" || tab === "controls")
          renderParent();
      });
    });

    if (els.paySubmit) els.paySubmit.addEventListener("click", tryPay);

    if (els.toggleBlocked)
      els.toggleBlocked.addEventListener("change", function () {
        state = loadState();
        state.settings.cardBlocked = els.toggleBlocked.checked;
        saveState(state);
        renderParent();
        if (!els.childShell.classList.contains("hidden")) renderChildHome();
      });

    if (els.btnSaveLimits)
      els.btnSaveLimits.addEventListener("click", function () {
        state = loadState();
        var d = parseInt(els.inputDaily.value, 10);
        var p = parseInt(els.inputPerTxn.value, 10);
        if (d >= 50 && d <= 50000) state.settings.dailyLimit = d;
        if (p >= 10 && p <= 10000) state.settings.perTxnLimit = p;
        saveState(state);
        renderParent();
        if (els.limitsSaved) {
          els.limitsSaved.classList.remove("hidden");
          els.limitsSaved.textContent = "Сохранено";
        }
      });

    els.modalBackdrop.addEventListener("click", function (e) {
      if (e.target === els.modalBackdrop) closeModal();
    });

    var sess = loadSession();
    if (sess && (sess.role === "child" || sess.role === "parent")) {
      selectedRole = sess.role;
      showApp();
      if (sess.role === "child") {
        els.childShell.classList.remove("hidden");
        els.parentShell.classList.add("hidden");
        els.childTopName.textContent = MOCK.child.name;
        els.childTopRole.textContent = "Детский аккаунт";
        els.childAvatar.textContent = MOCK.child.avatar;
        setChildView("home");
        afterChildShellViewChange("home");
        renderPayMerchants();
        renderHistory();
        renderPiggy();
        renderVideos();
        renderGames();
        renderSimHub();
        refreshGoalTab();
      } else {
        els.parentShell.classList.remove("hidden");
        els.childShell.classList.add("hidden");
        els.parentTopName.textContent = MOCK.parent.name;
        els.parentTopRole.textContent = "Родитель · " + MOCK.parent.childName;
        els.parentAvatar.textContent = MOCK.parent.avatar;
        setParentView("overview");
        renderParent();
        loadParentGrowth();
      }
    } else {
      showLogin();
    }
  }

  window.zernyshkoRenderSimHub = renderSimHub;
  window.zernyshkoSimEnterTab = simEnterTab;
  window.zernyshkoRefreshGoalTab = refreshGoalTab;
  window.zernyshkoNavigateChild = navigateChildFromHome;

  function bootstrap() {
    ensureClientId();
    pullFromServer().finally(function () {
      init();
    });
  }

  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", bootstrap);
  else bootstrap();
}
