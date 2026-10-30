<#--
  QueuePass sign-in page frame (spec 021, research R3, R9). Started from Keycloak 26.0's base
  login template.ftl and keeps its behavior: the registrationLayout macro and its sections, the
  attempted-username branch with its restart link, try another way, the scripts and import map,
  and the footer. What changes is the frame around the form:

  - the tab title and the page's one <h1> are "Sign in to {app name}", the name being the one the
    seed gives the client that started sign-in (FR-001, FR-002); with no client, or a client with
    no name, the realm's display name (FR-008);
  - a line saying who the app is for, from messages qpAudience.<clientId>, only when that message
    exists (FR-005, FR-008);
  - body class qp-app--<clientId>, which login.css maps to the app's accent (FR-006);
  - the page's own header ("We are sorry...", "Page has expired") as an <h2>, except on the sign-in
    form, whose "Sign in to your account" the <h1> replaces (FR-004);
  - page messages in the shared theme's banners, announced to assistive technology (FR-012).
-->
<#import "footer.ftl" as loginFooter>
<#macro registrationLayout bodyClass="" displayInfo=false displayMessage=true displayRequiredFields=false>
<#if client?? && client.name?has_content>
    <#assign qpAppName = advancedMsg(client.name)>
<#else>
    <#assign qpAppName = realm.displayName!"QueuePass">
</#if>
<#assign qpAppId = (client.clientId)!"">
<#assign qpTitle = msg("qpSignInTo", qpAppName)>
<#assign qpAudienceKey = "qpAudience." + qpAppId>
<#assign qpAudience = msg(qpAudienceKey)>
<#-- Keycloak 26 has no pageId: the page's own header is captured and compared instead (R9). -->
<#assign qpPageHeader><#nested "header"></#assign>
<#if qpPageHeader?is_markup_output>
    <#assign qpPageHeaderText = qpPageHeader?markup_string?trim>
    <#assign qpPageHeaderOut = qpPageHeaderText?no_esc>
<#else>
    <#assign qpPageHeaderText = qpPageHeader?trim>
    <#assign qpPageHeaderOut = qpPageHeaderText>
</#if>
<#assign qpShowPageHeader = qpPageHeaderText?has_content && qpPageHeaderText != msg("loginAccountTitle")>
<!DOCTYPE html>
<html lang="en">

<head>
    <meta charset="utf-8">
    <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
    <meta name="robots" content="noindex, nofollow">

    <#if properties.meta?has_content>
        <#list properties.meta?split(' ') as meta>
            <meta name="${meta?split('==')[0]}" content="${meta?split('==')[1]}"/>
        </#list>
    </#if>
    <title>${qpTitle}</title>
    <link rel="icon" href="${url.resourcesPath}/img/favicon.ico" />
    <#if properties.stylesCommon?has_content>
        <#list properties.stylesCommon?split(' ') as style>
            <link href="${url.resourcesCommonPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.styles?has_content>
        <#list properties.styles?split(' ') as style>
            <link href="${url.resourcesPath}/${style}" rel="stylesheet" />
        </#list>
    </#if>
    <#if properties.scripts?has_content>
        <#list properties.scripts?split(' ') as script>
            <script src="${url.resourcesPath}/${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="importmap">
        {
            "imports": {
                "rfc4648": "${url.resourcesCommonPath}/vendor/rfc4648/rfc4648.js"
            }
        }
    </script>
    <script src="${url.resourcesPath}/js/menu-button-links.js" type="module"></script>
    <#if scripts??>
        <#list scripts as script>
            <script src="${script}" type="text/javascript"></script>
        </#list>
    </#if>
    <script type="module">
        import { startSessionPolling } from "${url.resourcesPath}/js/authChecker.js";

        startSessionPolling(
          "${url.ssoLoginInOtherTabsUrl?no_esc}"
        );
    </script>
</head>

<body class="qp-app--${qpAppId}">
<div class="qp-band" aria-hidden="true"></div>
<main class="qp-login">
    <div class="card card--padded qp-card">
        <header class="qp-head">
            <span class="brand__mark qp-mark" aria-hidden="true">Q</span>
            <h1 class="qp-title">${qpTitle}</h1>
            <#if qpAudience != qpAudienceKey>
                <p class="qp-audience">${qpAudience}</p>
            </#if>
            <#if realm.internationalizationEnabled  && locale.supported?size gt 1>
                <div class="${properties.kcLocaleMainClass!}" id="kc-locale">
                    <div id="kc-locale-wrapper" class="${properties.kcLocaleWrapperClass!}">
                        <div id="kc-locale-dropdown" class="menu-button-links ${properties.kcLocaleDropDownClass!}">
                            <button tabindex="1" id="kc-current-locale-link" aria-label="${msg("languages")}" aria-haspopup="true" aria-expanded="false" aria-controls="language-switch1">${locale.current}</button>
                            <ul role="menu" tabindex="-1" aria-labelledby="kc-current-locale-link" aria-activedescendant="" id="language-switch1" class="${properties.kcLocaleListClass!}">
                                <#assign i = 1>
                                <#list locale.supported as l>
                                    <li class="${properties.kcLocaleListItemClass!}" role="none">
                                        <a role="menuitem" id="language-${i}" class="${properties.kcLocaleItemClass!}" href="${l.url}">${l.label}</a>
                                    </li>
                                    <#assign i++>
                                </#list>
                            </ul>
                        </div>
                    </div>
                </div>
            </#if>
        <#if !(auth?has_content && auth.showUsername() && !auth.showResetCredentials())>
            <#if qpShowPageHeader>
                <h2 id="kc-page-title" class="qp-page-title">${qpPageHeaderOut}</h2>
            </#if>
        <#else>
            <#nested "show-username">
            <div id="kc-username" class="${properties.kcFormGroupClass!} qp-username">
                <label id="kc-attempted-username">${auth.attemptedUsername}</label>
                <a id="reset-login" href="${url.loginRestartFlowUrl}" aria-label="${msg("restartLoginTooltip")}">
                    <div class="kc-login-tooltip">
                        <i class="${properties.kcResetFlowIcon!}"></i>
                        <span class="kc-tooltip-text">${msg("restartLoginTooltip")}</span>
                    </div>
                </a>
            </div>
        </#if>
        <#if displayRequiredFields>
            <p class="qp-required"><span class="required">*</span> ${msg("requiredFields")}</p>
        </#if>
        </header>
        <div id="kc-content">
            <div id="kc-content-wrapper">

            <#-- App-initiated actions should not see warning messages about the need to complete the action -->
            <#-- during login.                                                                               -->
            <#if displayMessage && message?has_content && (message.type != 'warning' || !isAppInitiatedAction??)>
                <#if message.type = 'error'>
                    <div class="${properties.kcAlertClass!} banner--error alert-error" role="alert">
                        <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                    </div>
                <#elseif message.type = 'success'>
                    <div class="${properties.kcAlertClass!} banner--success alert-success" role="status">
                        <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                    </div>
                <#elseif message.type = 'warning'>
                    <div class="${properties.kcAlertClass!} banner--conflict alert-warning" role="status">
                        <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                    </div>
                <#else>
                    <div class="${properties.kcAlertClass!} qp-banner--info alert-${message.type}" role="status">
                        <span class="${properties.kcAlertTitleClass!}">${kcSanitize(message.summary)?no_esc}</span>
                    </div>
                </#if>
            </#if>

            <#nested "form">

            <#if auth?has_content && auth.showTryAnotherWayLink()>
                <form id="kc-select-try-another-way-form" action="${url.loginAction}" method="post">
                    <div class="${properties.kcFormGroupClass!}">
                        <input type="hidden" name="tryAnotherWay" value="on"/>
                        <a href="#" id="try-another-way"
                           onclick="document.forms['kc-select-try-another-way-form'].requestSubmit();return false;">${msg("doTryAnotherWay")}</a>
                    </div>
                </form>
            </#if>

            <#nested "socialProviders">

            <#if displayInfo>
                <div id="kc-info" class="${properties.kcSignUpClass!}">
                    <div id="kc-info-wrapper" class="${properties.kcInfoAreaWrapperClass!}">
                        <#nested "info">
                    </div>
                </div>
            </#if>
            </div>
        </div>

        <@loginFooter.content/>
    </div>
</main>
</body>
</html>
</#macro>
