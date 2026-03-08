(function () {
  const fallbackVersion = {
    latestVersion: "1.6.1",
    minSupportedVersion: "1.6.0",
    forceUpdate: false,
    changelog: [
      "启动时进行版本门禁、会话恢复和健康快照同步。",
      "后端已统一成员、计划、设备、报告和医生解释接口。",
      "当前部署以 MySQL 持久化 + HTTP 联调为主。",
    ],
    downloadUrl: "http://nutriday.site/downloads/app-release.apk",
  };

  const features = [
    {
      title: "多成员健康档案",
      description:
        "支持为自己、孩子、伴侣或老人维护独立成员档案。每位成员拥有自己的报告、计划、设备和 AI 上下文。",
      tags: ["家庭场景", "数据隔离"],
      icon:
        "<path d='M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2'></path><circle cx='9' cy='7' r='4'></circle><path d='M23 21v-2a4 4 0 0 0-3-3.87'></path><path d='M16 3.13a4 4 0 0 1 0 7.75'></path>",
    },
    {
      title: "报告识别与确认",
      description:
        "体检、营养和体脂报告先识别，再进入人工确认层，不把 OCR 文本直接当成最终结果。",
      tags: ["OCR", "结构化确认"],
      icon:
        "<path d='M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z'></path><path d='M14 2v6h6'></path><path d='M8 13h8'></path><path d='M8 17h8'></path><path d='M10 9H8'></path>",
    },
    {
      title: "补剂盒位绑定",
      description:
        "把补剂品类、营养成分和 A-F 槽位长期绑定，成为计划计算和执行记录的稳定数据源。",
      tags: ["槽位映射", "营养定义"],
      icon:
        "<path d='M6 3h12'></path><path d='M6 8h12'></path><path d='M6 13h8'></path><path d='M6 18h8'></path><path d='M18 13v8'></path><path d='M14 17h8'></path>",
    },
    {
      title: "每日状态驱动计划",
      description:
        "睡眠、运动、症状和饮食变化会进入成员快照，并触发计划重算，而不是把建议固定在旧状态上。",
      tags: ["自动重算", "持续更新"],
      icon:
        "<path d='M12 6v6l4 2'></path><circle cx='12' cy='12' r='9'></circle>",
    },
    {
      title: "AI 医生解释",
      description:
        "解释围绕当前成员、当前计划和当前数据展开，并且显式标记结果来自 provider 还是 fallback。",
      tags: ["上下文解释", "来源可观察"],
      icon:
        "<path d='M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z'></path>",
    },
    {
      title: "设备同步与趋势",
      description:
        "后续可接入 BLE 健康设备，把测量值接入成员链路、趋势分析和计划更新逻辑。",
      tags: ["BLE", "趋势追踪"],
      icon:
        "<path d='M3 12h4l3 8 4-16 3 8h4'></path>",
    },
  ];

  const flow = [
    ["01", "上传报告或记录状态", "从拍照识别、导入报告或填写每日状态开始，把新增健康信息送进系统。"],
    ["02", "进入结构化确认层", "识别结果先确认，避免格式错误、缺字段或 OCR 误读直接污染长期数据。"],
    ["03", "计划自动重算", "成员快照、补剂槽位和设备数据变化后，会重新生成更贴近当前状态的建议。"],
    ["04", "AI 做解释与复盘", "用户继续围绕今天的计划提问，系统基于成员上下文给出解释和风险提示。"],
  ];

  const principles = [
    {
      title: "高对比、低噪音",
      description:
        "官网和 App 都优先使用高可读文本、稳定卡片层级和温和配色，避免“像 AI”但读不清的设计。",
      points: ["正文与说明文案对比明确", "浅色背景下卡片边界清晰"],
    },
    {
      title: "操作主次清楚",
      description:
        "下载、查看结构和继续联调有明确层级，不把每个按钮都做成主按钮。",
      points: ["下载按钮统一为主 CTA", "辅助动作保持次级按钮样式"],
    },
    {
      title: "动效克制",
      description:
        "只保留滚动揭示和 hover 微反馈，减少运动干扰，并尊重 reduced motion。",
      points: ["入场动画只播放一次", "系统偏好减少动画时自动降级"],
    },
  ];

  const assurance = [
    {
      title: "本地优先，不强依赖云端",
      description:
        "产品在本地与 HTTP 联调模式下已经可用，云端与 HTTPS 只是当前阶段的后续收口项。",
      icon:
        "<path d='M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z'></path><path d='m9 12 2 2 4-4'></path>",
    },
    {
      title: "AI 不替代诊断",
      description:
        "AI 回答用于解释计划、梳理变化和提醒风险，不替代专业医生诊断与治疗决策。",
      icon:
        "<path d='M12 2v20'></path><path d='M5 7h14'></path><path d='M5 17h14'></path>",
    },
    {
      title: "结果可追溯",
      description:
        "报告确认、计划重算、设备同步和医生解释都有明确来源，不再让重要结论漂浮在系统外。",
      icon:
        "<path d='M4 4h16v16H4z'></path><path d='M8 8h8'></path><path d='M8 12h8'></path><path d='M8 16h5'></path>",
    },
  ];

  const faqs = [
    {
      question: "现在是否已经有完整后端？",
      answer: "有。当前已验证 Node 后端、MySQL、HTTP 反代、登录、成员列表和医生解释链路。",
    },
    {
      question: "为什么暂时还是 HTTP？",
      answer: "因为 SSL/备案本轮暂时不继续推进。官网、下载和 App 联调目前统一按 HTTP 基线运行。",
    },
    {
      question: "AI 医生解释能否判断真实来源？",
      answer: "可以。后端响应已经支持 source 和 usedFallback 字段，用来区分 provider 和 fallback。",
    },
    {
      question: "Android 端为什么能调 HTTP？",
      answer: "因为当前 Manifest 和 network security config 临时放开了明文 HTTP，等 HTTPS 恢复后会再收回。",
    },
  ];

  function byId(id) {
    return document.getElementById(id);
  }

  function svg(icon) {
    return "<svg viewBox='0 0 24 24'>" + icon + "</svg>";
  }

  function safeSetText(id, value) {
    const element = byId(id);
    if (element) {
      element.textContent = value;
    }
  }

  function safeSetHtml(id, value) {
    const element = byId(id);
    if (element) {
      element.innerHTML = value;
    }
  }

  function renderFeatures() {
    const element = byId("featureGrid");
    if (!element) return;
    element.innerHTML = features
      .map(function (item) {
        return (
          "<article class='feature-card reveal'>" +
          "<div class='feature-icon' aria-hidden='true'>" +
          svg(item.icon) +
          "</div>" +
          "<h3>" + item.title + "</h3>" +
          "<p>" + item.description + "</p>" +
          "<div class='feature-tags'>" +
          item.tags.map(function (tag) { return "<span>" + tag + "</span>"; }).join("") +
          "</div></article>"
        );
      })
      .join("");
  }

  function renderWorkflow() {
    const element = byId("workflowShell");
    if (!element) return;
    element.innerHTML =
      "<div class='workflow-grid'>" +
      flow
        .map(function (item) {
          return (
            "<article class='workflow-card'>" +
            "<div class='workflow-step'>" + item[0] + "</div>" +
            "<h3>" + item[1] + "</h3>" +
            "<p>" + item[2] + "</p>" +
            "</article>"
          );
        })
        .join("") +
      "</div>" +
      "<div class='workflow-foot'>" +
      "<div><strong>当前规则</strong><p>报告确认、每日状态、补剂槽位和设备数据变化，都会成为计划重算的触发器。</p></div>" +
      "<div class='workflow-badge'>Data change -> Recompute</div>" +
      "</div>";
  }

  function renderPreview() {
    const element = byId("previewShell");
    if (!element) return;
    element.innerHTML =
      "<div class='preview-window'>" +
      "<div class='preview-header'><h3>Settings</h3><span>App Preview</span></div>" +
      "<div class='settings-group'><h4>Theme</h4><div class='settings-card'><div class='settings-options'>" +
      "<div class='setting-option'><div class='setting-main'><div class='setting-icon' aria-hidden='true'>" +
      svg("<path d='M12 3a6 6 0 1 0 9 9 8 8 0 1 1-9-9z'></path>") +
      "</div><div class='setting-copy'><strong>深色</strong><span>适合夜间阅读或低光环境</span></div></div><div class='radio-dot'></div></div>" +
      "<div class='setting-option'><div class='setting-main'><div class='setting-icon' aria-hidden='true'>" +
      svg("<circle cx='12' cy='12' r='4'></circle><path d='M12 2v2'></path><path d='M12 20v2'></path><path d='m4.93 4.93 1.41 1.41'></path><path d='m17.66 17.66 1.41 1.41'></path><path d='M2 12h2'></path><path d='M20 12h2'></path><path d='m6.34 17.66-1.41 1.41'></path><path d='m19.07 4.93-1.41 1.41'></path>") +
      "</div><div class='setting-copy'><strong>浅色</strong><span>适合白天和官网浏览场景</span></div></div><div class='radio-dot is-selected'></div></div>" +
      "</div></div></div>" +
      "<div class='settings-group'><h4>App Info</h4><div class='settings-card'>" +
      "<div class='settings-row'><div class='settings-main'><div class='settings-bullet' aria-hidden='true'></div><div class='settings-copy'><strong>Version</strong><span>当前 Flutter 构建版本</span></div></div><div class='settings-value'>1.6.1+7</div></div>" +
      "<div class='settings-row'><div class='settings-main'><div class='settings-bullet' aria-hidden='true'></div><div class='settings-copy'><strong>Transport</strong><span>当前联调使用明文 HTTP</span></div></div><div class='settings-value soft'>HTTP</div></div>" +
      "<div class='settings-row'><div class='settings-main'><div class='settings-bullet' aria-hidden='true'></div><div class='settings-copy'><strong>Doctor Explain</strong><span>结果包含 source 和 usedFallback</span></div></div><div class='settings-value soft'>Observable</div></div>" +
      "</div></div>" +
      "<div class='preview-tabs'><div class='tab-chip'><span class='tab-dot' aria-hidden='true'></span><span>Home</span></div><div class='tab-chip'><span class='tab-dot' aria-hidden='true'></span><span>Members</span></div><div class='tab-chip'><span class='tab-dot' aria-hidden='true'></span><span>Plan</span></div><div class='tab-chip active'><span class='tab-dot' aria-hidden='true'></span><span>Settings</span></div></div>" +
      "</div>";
  }

  function renderPrinciples() {
    const element = byId("principleGrid");
    if (!element) return;
    element.innerHTML = principles
      .map(function (item) {
        return (
          "<article class='stack-card reveal'>" +
          "<h3>" + item.title + "</h3>" +
          "<p>" + item.description + "</p>" +
          "<ul class='stack-list'>" +
          item.points.map(function (point) { return "<li>" + point + "</li>"; }).join("") +
          "</ul></article>"
        );
      })
      .join("");
  }

  function renderAssurance() {
    const element = byId("assuranceGrid");
    if (!element) return;
    element.innerHTML = assurance
      .map(function (item) {
        return (
          "<article class='feature-card reveal'>" +
          "<div class='feature-icon' aria-hidden='true'>" + svg(item.icon) + "</div>" +
          "<h3>" + item.title + "</h3>" +
          "<p>" + item.description + "</p>" +
          "</article>"
        );
      })
      .join("");
  }

  function renderDownloadCard() {
    const element = byId("downloadCard");
    if (!element) return;
    element.innerHTML =
      "<div class='download-panel'>" +
      "<h3>Nutriday Android 安装包</h3>" +
      "<p>下载信息优先从后端版本接口同步。当前官网基线使用 HTTP，便于继续联调 App、后端和静态站点。</p>" +
      "<div class='download-info'>" +
      "<div class='info-box'><span>版本</span><strong id='landingDownloadVersion'>加载中</strong></div>" +
      "<div class='info-box'><span>最小支持</span><strong id='landingMinVersion'>加载中</strong></div>" +
      "<div class='info-box'><span>下载方式</span><strong id='landingDownloadMode'>HTTP</strong></div>" +
      "<div class='info-box'><span>后端状态</span><strong id='landingApiMode'>检测中</strong></div>" +
      "</div>" +
      "<div class='download-actions'>" +
      "<a class='btn btn-primary' href='/downloads/app-release.apk' data-download-target download='Nutriday-AI-Health.apk'>下载 APK</a>" +
      "<a class='btn btn-secondary' href='downloads.html'>查看下载页</a>" +
      "</div>" +
      "<div class='download-link' data-download-url-text>http://nutriday.site/downloads/app-release.apk</div>" +
      "</div>" +
      "<aside class='install-steps' aria-label='部署建议'>" +
      "<h4>今晚联调建议</h4>" +
      "<div class='install-step'><div class='install-index'>1</div><div><strong>先测 HTTP API</strong><p>当前版本检查、登录、成员和医生解释接口都按 HTTP 基线验证。</p></div></div>" +
      "<div class='install-step'><div class='install-index'>2</div><div><strong>再装 App</strong><p>用官网 APK 或 Flutter 直接运行，确认应用端连接当前 API 基地址。</p></div></div>" +
      "<div class='install-step'><div class='install-index'>3</div><div><strong>最后再收 HTTPS</strong><p>备案和 SSL 不在今晚阻塞项内，等域名链路恢复后再统一切换。</p></div></div>" +
      "</aside>";
  }

  function renderFaqs() {
    const element = byId("faqList");
    if (!element) return;
    element.innerHTML = faqs
      .map(function (item, index) {
        return (
          "<details" + (index === 0 ? " open" : "") + ">" +
          "<summary>" + item.question + "</summary>" +
          "<p>" + item.answer + "</p>" +
          "</details>"
        );
      })
      .join("");
  }

  function updateDownloadTargets(url) {
    document.querySelectorAll("[data-download-target]").forEach(function (element) {
      element.setAttribute("href", url);
    });
    document.querySelectorAll("[data-download-url-text]").forEach(function (element) {
      element.textContent = url;
    });
    safeSetText("downloadHrefText", url.replace(/^https?:\/\//, ""));
  }

  function updateVersionPolicy(policy) {
    safeSetText("versionText", policy.latestVersion || fallbackVersion.latestVersion);
    safeSetText("versionDetail", "最低支持 " + (policy.minSupportedVersion || fallbackVersion.minSupportedVersion));
    safeSetText("downloadModeText", (policy.downloadUrl || fallbackVersion.downloadUrl).startsWith("https://") ? "HTTPS" : "HTTP");
    safeSetText("landingDownloadVersion", policy.latestVersion || fallbackVersion.latestVersion);
    safeSetText("landingMinVersion", policy.minSupportedVersion || fallbackVersion.minSupportedVersion);
    safeSetText("landingDownloadMode", (policy.downloadUrl || fallbackVersion.downloadUrl).startsWith("https://") ? "HTTPS" : "HTTP");
    safeSetText("downloadPageVersion", policy.latestVersion || fallbackVersion.latestVersion);
    safeSetText(
      "downloadPagePolicy",
      (policy.forceUpdate ? "强制更新" : "建议更新") + " · 最低支持 " + (policy.minSupportedVersion || fallbackVersion.minSupportedVersion)
    );
    safeSetText("timelineVersion", "版本 " + (policy.latestVersion || fallbackVersion.latestVersion));
    updateDownloadTargets(policy.downloadUrl || fallbackVersion.downloadUrl);
  }

  function updateHealthStatus(isHealthy, storageKind) {
    safeSetText("apiStatusText", isHealthy ? "运行中" : "异常");
    safeSetText("apiStatusDetail", isHealthy ? "HTTP API 已响应" : "请检查 /healthz");
    safeSetText("landingApiMode", isHealthy ? "在线" : "异常");
    safeSetText("runtimeModeText", storageKind || (isHealthy ? "Healthy" : "Unavailable"));
    safeSetText("storageText", storageKind || "unknown");
    safeSetText("downloadStorageKind", storageKind || "unknown");
  }

  async function fetchJson(url) {
    const response = await fetch(url, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Request failed: " + response.status);
    }
    return response.json();
  }

  async function syncRuntimeStatus() {
    const apiRoot = window.location.origin;
    const versionUrl = apiRoot + "/api/version/latest";
    const healthUrl = apiRoot + "/healthz";

    try {
      const [versionPolicy, healthStatus] = await Promise.allSettled([
        fetchJson(versionUrl),
        fetchJson(healthUrl),
      ]);

      if (versionPolicy.status === "fulfilled") {
        updateVersionPolicy(versionPolicy.value);
      } else {
        updateVersionPolicy(fallbackVersion);
      }

      if (healthStatus.status === "fulfilled") {
        const payload = healthStatus.value || {};
        updateHealthStatus(true, payload.storage || payload.kind || "mysql");
      } else {
        updateHealthStatus(false, "unknown");
      }
    } catch (error) {
      updateVersionPolicy(fallbackVersion);
      updateHealthStatus(false, "unknown");
    }
  }

  function setupHeader() {
    const header = byId("siteHeader");
    if (!header) return;
    const onScroll = function () {
      header.classList.toggle("is-scrolled", window.scrollY > 12);
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
  }

  function setupMobileMenu() {
    const toggle = document.querySelector(".mobile-menu-toggle");
    const nav = byId("mainNav");
    if (!toggle || !nav) return;
    toggle.addEventListener("click", function () {
      const expanded = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", expanded ? "false" : "true");
      nav.classList.toggle("is-open", !expanded);
    });
  }

  function setupReveal() {
    const items = Array.from(document.querySelectorAll(".reveal"));
    if (!items.length) return;
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduceMotion || !("IntersectionObserver" in window)) {
      items.forEach(function (item) { item.classList.add("is-visible"); });
      return;
    }

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) {
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15 });

    items.forEach(function (item) { observer.observe(item); });
  }

  function setupCopyButton() {
    const button = byId("copyLinkButton");
    if (!button) return;
    button.addEventListener("click", async function () {
      const link = document.querySelector("[data-download-url-text]");
      const value = link ? link.textContent.trim() : fallbackVersion.downloadUrl;
      try {
        await navigator.clipboard.writeText(value);
        button.textContent = "已复制下载链接";
        setTimeout(function () {
          button.innerHTML =
            "<svg viewBox='0 0 24 24'><rect x='9' y='9' width='13' height='13' rx='2' ry='2'></rect><path d='M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1'></path></svg>复制下载链接";
        }, 1800);
      } catch (error) {
        window.prompt("请手动复制下载地址", value);
      }
    });
  }

  function setupActiveLinks() {
    const links = Array.from(document.querySelectorAll(".nav-links a[href^='#']"));
    if (!links.length || !("IntersectionObserver" in window)) return;
    const map = new Map();
    links.forEach(function (link) {
      const id = link.getAttribute("href").slice(1);
      const target = byId(id);
      if (target) {
        map.set(target, link);
      }
    });
    if (!map.size) return;

    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        const link = map.get(entry.target);
        if (link && entry.isIntersecting) {
          links.forEach(function (item) { item.classList.remove("is-active"); });
          link.classList.add("is-active");
        }
      });
    }, { threshold: 0.45 });

    map.forEach(function (_, target) { observer.observe(target); });
  }

  function setCurrentYear() {
    safeSetText("currentYear", String(new Date().getFullYear()));
  }

  function init() {
    renderFeatures();
    renderWorkflow();
    renderPreview();
    renderPrinciples();
    renderAssurance();
    renderDownloadCard();
    renderFaqs();
    setCurrentYear();
    setupHeader();
    setupMobileMenu();
    setupReveal();
    setupCopyButton();
    setupActiveLinks();
    syncRuntimeStatus();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();
