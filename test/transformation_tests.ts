import {equal as assertEqual} from 'assert';
import {injectIntoHead, exposeClosureState} from '../src/lib/transformations';
import {readFileSync} from 'fs';

const AGENT_SOURCE = readFileSync(require.resolve('../src/lib/deuterium_agent'), "utf8");

const LOOMIO = `<!DOCTYPE html>
<html ng-app='loomioApp' ng-controller='RootController as app'>
  <head>
    <title>Loomio</title>
    <meta charset='utf-8'>
    <meta content='IE=Edge' http-equiv='X-UA-Compatible'>
    <meta content='width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no' name='viewport'>
    <base href='/'>
    <link ng-href='{{links.canonical}}' ng-if='links.canonical' rel='canonical'>
    <link ng-href='{{links.rss}}' ng-if='links.rss' rel='alternate' type='application/rss+xml'>
    <link ng-href='{{links.prev}}' ng-if='links.prev' rel='prev'>
    <link ng-href='{{links.next}}' ng-if='links.next' rel='next'>
    <link href='/manifest.json' rel='manifest'>
    <link href='/client/development/app.css' rel='stylesheet'>
    <link href='https://fonts.googleapis.com/icon?family=Material+Icons' rel='stylesheet'>
    <meta content='Loomio' property='og:site_name'>
    <meta content='en' property='og:locale'>
    <meta content='http://localhost:3000/dashboard' property='og:url'>
    <meta property='fb:app_id'>
    <meta content='summary' name='twitter:card'>
    <meta content='Loomio' name='twitter:site'>
    <meta content='http://localhost:3000/dashboard' name='twitter:url'>


  </head>
  <body flex='' layout='column' ng-keydown='keyDown($event)'>
    <flash></flash>
    <navbar></navbar>
    <md_content class='lmo-sidebar-and-main-container' flex='' layout='row'>
      <sidebar ng-if='isLoggedIn() &amp;&amp; renderSidebar'></sidebar>
      <md_content class='lmo-main-content' flex=''>
        <div class='lmo-main-background'>
          <ng_outlet ng-if='!refreshing &amp;&amp; !pageError'></ng_outlet>
          <error_page error='pageError' ng-if='pageError'></error_page>
        </div>
      </md_content>
    </md_content>
    <outlet name='after-start-menu'></outlet>
    <script src='/client/development/vendor.js'></script>
    <script>
      window.Loomio = {"bootData":{"memberships":[{"id":2,"volume":"normal","admin":true,"experiences":{},"created_at":"2017-07-19T15:01:33.206-07:00","group_id":1,"user_id":1,"inviter_id":null}],"groups":[{"id":1,"organisation_id":1,"cohort_id":null,"key":"VYX35GOj","name":"Fun Group 1","full_name":"Fun Group 1","created_at":"2017-07-19T15:01:32.199-07:00","creator_id":1,"description":"It's fun!","members_can_add_members":true,"members_can_create_subgroups":false,"members_can_start_discussions":true,"members_can_edit_discussions":true,"members_can_edit_comments":true,"members_can_raise_motions":true,"members_can_vote":true,"motions_count":0,"closed_motions_count":0,"polls_count":1,"closed_polls_count":0,"proposal_outcomes_count":0,"discussions_count":2,"public_discussions_count":0,"announcement_recipients_count":1,"group_privacy":"closed","is_visible_to_parent_members":false,"parent_members_can_see_discussions":false,"memberships_count":1,"invitations_count":1,"pending_invitations_count":0,"membership_granted_upon":"approval","discussion_privacy_options":"private_only","cover_urls":{"small":"img/default-cover-photo.png","medium":"img/default-cover-photo.png","large":"img/default-cover-photo.png"},"has_discussions":true,"has_multiple_admins":false,"archived_at":null,"has_custom_cover":false,"is_subgroup_of_hidden_parent":false,"enable_experiments":false,"experiences":{},"features":{"use_polls":true},"recent_activity_count":0,"identity_id":null,"parent_id":null}],"users":[{"id":1,"key":"euYgOBK9","name":null,"username":"default","short_bio":"","avatar_initials":"DE","avatar_kind":"initials","gravatar_md5":"f098afaef3febde599c54c4116a5750c","time_zone":"America/Los_Angeles","search_fragment":null,"label":"default","locale":"en","created_at":"2017-07-19T14:58:39.264-07:00","email":"default@loomio.org","email_when_proposal_closing_soon":false,"email_missed_yesterday":true,"email_when_mentioned":true,"email_on_participation":false,"selected_locale":null,"default_membership_volume":"normal","experiences":{},"is_coordinator":true,"membership_ids":[2],"unread_thread_ids":[1],"notification_ids":[],"visitor_ids":[],"identity_ids":[]}],"discussions":[{"id":1,"key":"D7jPdnFy","title":"Welcome! Please introduce yourself","description":"Take a moment to let the group know a bit about who you are. Post a comment below.\n\nWhat’s your role or approach to participation in this group? What should people know about you to understand where you’re coming from?\n","items_count":0,"salient_items_count":0,"first_sequence_id":0,"last_sequence_id":0,"last_comment_at":null,"last_activity_at":"2017-07-19T15:01:32.434-07:00","created_at":"2017-07-19T15:01:32.434-07:00","updated_at":"2017-07-19T15:01:32.434-07:00","archived_at":null,"private":true,"versions_count":0,"discussion_reader_id":3,"read_items_count":0,"read_salient_items_count":0,"last_read_sequence_id":0,"discussion_reader_volume":null,"last_read_at":null,"dismissed_at":null,"participating":false,"starred":false,"mentioned_usernames":[],"author_id":2,"group_id":1,"active_proposal_id":null,"attachment_ids":[]}],"proposals":[],"attachments":[],"notifications":[],"visitors":[],"identities":[],"current_user_id":1},"version":"1.8.67","environment":"development","loadVideos":false,"flash":{"notice":"Signed in successfully."},"currentVisitorId":null,"currentUserLocale":"en","currentUrl":"http://localhost:3000/dashboard","permittedParams":{"user":["name","avatar_kind","email","password","password_confirmation","current_password","remember_me","uploaded_avatar","username","uses_markdown","short_bio","time_zone","selected_locale","email_when_mentioned","default_membership_volume","email_missed_yesterday","deactivation_response","has_password","email_status","email_when_proposal_closing_soon","email_new_discussions_and_proposals","email_on_participation",{"email_new_discussions_and_proposals_group_ids":[]}],"visitor":["name","email","revoked","community_id"],"vote":["position","statement","proposal_id","motion_id"],"motion":["name","description","discussion_id","closing_at","outcome","attachment_ids",{"attachment_ids":[]}],"membership_request":["name","email","introduction","group_id"],"membership":["volume","apply_to_all","set_default"],"poll":["title","details","poll_type","discussion_id","group_id","closing_at","make_announcement","multiple_choice","key","anyone_can_participate","notify_on_participate","voter_can_add_options","custom_fields",{"custom_fields":["dots_per_person","time_zone","meeting_duration","pending_emails",{"pending_emails":[]}]},"attachment_ids",{"attachment_ids":[]},"communities_attributes",{"communities_attributes":["community_type","custom_fields"]},"poll_option_names",{"poll_option_names":[]},"community_id",{"community_id":[]}],"outcome":["statement","poll_id","poll_option_id","make_announcement","custom_fields",{"custom_fields":["event_location","event_summary","event_description"]}],"stance":["poll_id","reason","visitor_attributes",{"visitor_attributes":["name","email","participation_token"]},"stance_choices_attributes",{"stance_choices_attributes":["score","poll_option_id"]}],"invitation":["recipient_email","recipient_name","intent"],"group_request":["name","admin_name","admin_email","description"],"group":["parent_id","name","group_privacy","is_visible_to_public","discussion_privacy_options","members_can_add_members","members_can_edit_discussions","members_can_edit_comments","motions_can_be_edited","description","is_visible_to_parent_members","parent_members_can_see_discussions","membership_granted_upon","cover_photo","logo","category_id","identity_id","make_announcement","members_can_raise_motions","members_can_vote","members_can_start_discussions","members_can_create_subgroups"],"discussion":["title","attachment_ids","description","uses_markdown","group_id","private","iframe_src","starred","make_announcement",{"attachment_ids":[]}],"discussion_reader":["discussion_id","volume","starred"],"comment":["body","attachment_ids","uses_markdown","discussion_id","parent_id",{"attachment_ids":[]}],"attachment":["file","filename","location","filesize","redirect"],"contact_message":["email","message","name","destination"],"user_deactivation_response":["body"],"network_membership_request":["group_id","network_id","message"],"draft":["payload"],"oauth_application":["name","redirect_uri","logo"],"community":["community_type","poll_id","identity_id","identifier","custom_fields",{"custom_fields":["facebook_group_name","slack_channel_name"]}],"poll_community":["poll_id","community_id"]},"locales":[{"key":"en","name":"English"},{"key":"ar","name":"العربية/عربي"},{"key":"an","name":"aragonés"},{"key":"be-BY","name":"беларуская мова"},{"key":"bg-BG","name":"български"},{"key":"ca","name":"Català"},{"key":"cs","name":"čeština"},{"key":"zh-TW","name":"正體中文"},{"key":"da","name":"Dansk"},{"key":"de","name":"Deutsch"},{"key":"eo","name":"Esperanto"},{"key":"es","name":"Español"},{"key":"el","name":"ελληνικά"},{"key":"fr","name":"Français"},{"key":"ga-IE","name":"Gaeilge"},{"key":"id","name":"Indonesian"},{"key":"it","name":"Italiano"},{"key":"he","name":"עברית"},{"key":"hu","name":"Magyar"},{"key":"ja","name":"日本語"},{"key":"ko","name":"한국어"},{"key":"ml","name":"മലയാളം"},{"key":"nl-NL","name":"Nederlands"},{"key":"pl","name":"język polski"},{"key":"pt-BR","name":"Português (Brasil)"},{"key":"ro","name":"Română"},{"key":"sr","name":"Srpski - Latinica"},{"key":"sr-RS","name":"Srpski - Ćirilica"},{"key":"sk","name":"slovenčina"},{"key":"sl","name":"slovenski jezik"},{"key":"sv","name":"Svenska"},{"key":"vi","name":"Tiếng Việt"},{"key":"tr","name":"Türkçe"},{"key":"uk","name":"українська мова"}],"siteName":"Loomio","recaptchaKey":null,"baseUrl":"http://localhost:3000/","safeThreadItemKinds":["new_comment","new_motion","new_vote","motion_closed","motion_closed_by_user","motion_edited","motion_outcome_created","motion_outcome_updated","discussion_edited","discussion_moved","poll_created","poll_edited","stance_created","outcome_created","poll_expired","poll_closed_by_user"],"plugins":{"installed":[],"outlets":{},"routes":[]},"inlineTranslation":{"isAvailable":false,"supportedLangs":[]},"pageSize":{"default":30,"groupThreads":30,"threadItems":30,"exploreGroups":10},"flashTimeout":{"short":3500,"long":2147483645},"drafts":{"debounce":750},"searchFilters":{"status":["active","closed"]},"pendingIdentity":null,"emojis":{"defaults":[":heart:",":smiley:",":sweat_smile:",":star:",":rabbit:",":ok:",":thumbsup:",":nz:",":walking:",":clap:"]},"notifications":{"kinds":["comment_liked","motion_closing_soon","comment_replied_to","user_mentioned","membership_requested","membership_request_approved","user_added_to_group","motion_closed","motion_closing_soon","motion_outcome_created","invitation_accepted","new_coordinator","poll_created","poll_closing_soon","poll_edited","poll_expired","outcome_created","stance_created","poll_option_added"]},"durations":[{"minutes":5,"label":"5 minutes"},{"minutes":10,"label":"10 minutes"},{"minutes":15,"label":"15 minutes"},{"minutes":20,"label":"20 minutes"},{"minutes":30,"label":"30 minutes"},{"minutes":45,"label":"45 minutes"},{"minutes":60,"label":"1 hour","default":true},{"minutes":90,"label":"90 minutes"},{"minutes":120,"label":"2 hours"},{"minutes":180,"label":"3 hours"},{"minutes":240,"label":"4 hours"},{"minutes":null,"label":"All Day"}],"pollTemplates":{"proposal":{"poll_options_attributes":[{"name":"agree"},{"name":"abstain"},{"name":"disagree"},{"name":"block"}],"chart_type":"pie","material_icon":"thumbs_up_down","has_option_icons":true,"translate_option_name":true,"can_remove_options":true,"must_have_options":true,"voters_review_responses":true,"require_stance_choice":true,"single_choice":true,"sort_options":["newest_first","oldest_first","priority_first","priority_last"]},"count":{"poll_options_attributes":[{"name":"yes"},{"name":"no"}],"chart_type":"progress","material_icon":"check_circle","has_option_icons":true,"must_have_options":true,"require_stance_choice":true,"single_choice":true,"sort_options":["newest_first","oldest_first","priority_first","priority_last"]},"poll":{"poll_options_attributes":[],"chart_type":"bar","material_icon":"equalizer","can_add_options":true,"can_remove_options":true,"must_have_options":true,"single_choice":true,"sort_options":["newest_first","oldest_first"]},"dot_vote":{"poll_options_attributes":[],"chart_type":"bar","material_icon":"grain","can_add_options":true,"can_remove_options":true,"must_have_options":true,"has_variable_score":true,"required_custom_fields":["dots_per_person"],"sort_options":["newest_first","oldest_first"]},"meeting":{"poll_options_attributes":[],"chart_type":"matrix","material_icon":"date_range","can_add_options":true,"can_remove_options":true,"must_have_options":true,"dates_as_options":true,"author_receives_outcome":true,"sort_options":["newest_first","oldest_first"]}},"pollColors":{"poll":["#70C9F8","#C8E56E","#D38FE1","#999FDE","#FA8295","#97D298","#C19A93","#F68AC6","#70C9F8","#C8E56E","#D38FE1","#999FDE","#FA8295","#97D298","#C19A93","#F68AC6","#70C9F8","#C8E56E","#D38FE1","#999FDE","#FA8295","#97D298","#C19A93","#F68AC6"],"proposal":["#00D177","#F6A82B","#F96168","#CE261B"],"count":["#1CA9F4","#DDDDDD"],"dot_vote":["#70C9F8","#C8E56E","#D38FE1","#999FDE","#FA8295","#97D298","#C19A93","#F68AC6","#70C9F8","#C8E56E","#D38FE1","#999FDE","#FA8295","#97D298","#C19A93","#F68AC6","#70C9F8","#C8E56E","#D38FE1","#999FDE","#FA8295","#97D298","#C19A93","#F68AC6"],"meeting":["#70C9F8","#C8E56E","#D38FE1","#999FDE","#FA8295","#97D298","#C19A93","#F68AC6","#70C9F8","#C8E56E","#D38FE1","#999FDE","#FA8295","#97D298","#C19A93","#F68AC6","#70C9F8","#C8E56E","#D38FE1","#999FDE","#FA8295","#97D298","#C19A93","#F68AC6"],"missing":"#FF0000"},"timeZones":{"International Date Line West":"Pacific/Midway","Midway Island":"Pacific/Midway","American Samoa":"Pacific/Pago_Pago","Hawaii":"Pacific/Honolulu","Alaska":"America/Juneau","Pacific Time":"America/Los_Angeles","Tijuana":"America/Tijuana","Mountain Time":"America/Denver","Arizona":"America/Phoenix","Chihuahua":"America/Chihuahua","Mazatlan":"America/Mazatlan","Central Time":"America/Chicago","Saskatchewan":"America/Regina","Guadalajara":"America/Mexico_City","Mexico City":"America/Mexico_City","Monterrey":"America/Monterrey","Central America":"America/Guatemala","Eastern Time":"America/New_York","Indiana (East)":"America/Indiana/Indianapolis","Bogota":"America/Bogota","Lima":"America/Lima","Quito":"America/Lima","Atlantic Time":"America/Halifax","Caracas":"America/Caracas","La Paz":"America/La_Paz","Santiago":"America/Santiago","Newfoundland":"America/St_Johns","Brasilia":"America/Sao_Paulo","Buenos Aires":"America/Argentina/Buenos_Aires","Montevideo":"America/Montevideo","Georgetown":"America/Guyana","Greenland":"America/Godthab","Mid-Atlantic":"Atlantic/South_Georgia","Azores":"Atlantic/Azores","Cape Verde Is.":"Atlantic/Cape_Verde","Dublin":"Europe/Dublin","Edinburgh":"Europe/London","Lisbon":"Europe/Lisbon","London":"Europe/London","Casablanca":"Africa/Casablanca","Monrovia":"Africa/Monrovia","UTC":"Etc/UTC","Belgrade":"Europe/Belgrade","Bratislava":"Europe/Bratislava","Budapest":"Europe/Budapest","Ljubljana":"Europe/Ljubljana","Prague":"Europe/Prague","Sarajevo":"Europe/Sarajevo","Skopje":"Europe/Skopje","Warsaw":"Europe/Warsaw","Zagreb":"Europe/Zagreb","Brussels":"Europe/Brussels","Copenhagen":"Europe/Copenhagen","Madrid":"Europe/Madrid","Paris":"Europe/Paris","Amsterdam":"Europe/Amsterdam","Berlin":"Europe/Berlin","Bern":"Europe/Zurich","Zurich":"Europe/Zurich","Rome":"Europe/Rome","Stockholm":"Europe/Stockholm","Vienna":"Europe/Vienna","West Central Africa":"Africa/Algiers","Bucharest":"Europe/Bucharest","Cairo":"Africa/Cairo","Helsinki":"Europe/Helsinki","Kyiv":"Europe/Kiev","Riga":"Europe/Riga","Sofia":"Europe/Sofia","Tallinn":"Europe/Tallinn","Vilnius":"Europe/Vilnius","Athens":"Europe/Athens","Istanbul":"Europe/Istanbul","Minsk":"Europe/Minsk","Jerusalem":"Asia/Jerusalem","Harare":"Africa/Harare","Pretoria":"Africa/Johannesburg","Kaliningrad":"Europe/Kaliningrad","Moscow":"Europe/Moscow","St. Petersburg":"Europe/Moscow","Volgograd":"Europe/Volgograd","Samara":"Europe/Samara","Kuwait":"Asia/Kuwait","Riyadh":"Asia/Riyadh","Nairobi":"Africa/Nairobi","Baghdad":"Asia/Baghdad","Tehran":"Asia/Tehran","Abu Dhabi":"Asia/Muscat","Muscat":"Asia/Muscat","Baku":"Asia/Baku","Tbilisi":"Asia/Tbilisi","Yerevan":"Asia/Yerevan","Kabul":"Asia/Kabul","Ekaterinburg":"Asia/Yekaterinburg","Islamabad":"Asia/Karachi","Karachi":"Asia/Karachi","Tashkent":"Asia/Tashkent","Chennai":"Asia/Kolkata","Kolkata":"Asia/Kolkata","Mumbai":"Asia/Kolkata","New Delhi":"Asia/Kolkata","Kathmandu":"Asia/Kathmandu","Astana":"Asia/Dhaka","Dhaka":"Asia/Dhaka","Sri Jayawardenepura":"Asia/Colombo","Almaty":"Asia/Almaty","Novosibirsk":"Asia/Novosibirsk","Rangoon":"Asia/Rangoon","Bangkok":"Asia/Bangkok","Hanoi":"Asia/Bangkok","Jakarta":"Asia/Jakarta","Krasnoyarsk":"Asia/Krasnoyarsk","Beijing":"Asia/Shanghai","Chongqing":"Asia/Chongqing","Hong Kong":"Asia/Hong_Kong","Urumqi":"Asia/Urumqi","Kuala Lumpur":"Asia/Kuala_Lumpur","Singapore":"Asia/Singapore","Taipei":"Asia/Taipei","Perth":"Australia/Perth","Irkutsk":"Asia/Irkutsk","Ulaanbaatar":"Asia/Ulaanbaatar","Seoul":"Asia/Seoul","Osaka":"Asia/Tokyo","Sapporo":"Asia/Tokyo","Tokyo":"Asia/Tokyo","Yakutsk":"Asia/Yakutsk","Darwin":"Australia/Darwin","Adelaide":"Australia/Adelaide","Canberra":"Australia/Melbourne","Melbourne":"Australia/Melbourne","Sydney":"Australia/Sydney","Brisbane":"Australia/Brisbane","Hobart":"Australia/Hobart","Vladivostok":"Asia/Vladivostok","Guam":"Pacific/Guam","Port Moresby":"Pacific/Port_Moresby","Magadan":"Asia/Magadan","Srednekolymsk":"Asia/Srednekolymsk","Solomon Is.":"Pacific/Guadalcanal","New Caledonia":"Pacific/Noumea","Fiji":"Pacific/Fiji","Kamchatka":"Asia/Kamchatka","Marshall Is.":"Pacific/Majuro","Auckland":"Pacific/Auckland","Wellington":"Pacific/Auckland","Nuku'alofa":"Pacific/Tongatapu","Tokelau Is.":"Pacific/Fakaofo","Chatham Is.":"Pacific/Chatham","Samoa":"Pacific/Apia"},"communityProviders":["facebook","slack"],"identityProviders":[]}
      window.Loomio.emojis.source = (emojione.shortnames || "").split("|")
      window.Loomio.emojis.render = emojione.shortnameToImage
    </script>
    <script src='/client/development/app.js'></script>

  </body>
</html>`;

describe('Transformations', function() {
  describe('injectIntoHead', function() {
    const headTagTypes = [
      [`<head>`, `</head>`, 'is in lowercase'],
      [`<HEAD>`, `</HEAD>`, 'is in uppercase'],
      [`<heAd>`, `</HeAd>`, 'is in a mix of lower and uppercase'],
      [`< head >`, `</ head>`, 'has whitespace within tag'],
      [`<\n\thead\n\t>`, `</\n\thead>`, 'has newlines within tag'],
      [``, ``, 'is missing']
    ];

    headTagTypes.forEach((headTag) => {
      it(`should work when the head tag ${headTag[2]}`, function() {
        const source = `<!DOCTYPE html><html>${headTag[0]}${headTag[1]}</html>`;
        const injection = `hello`;
        const output = `<!DOCTYPE html><html>${headTag[0]}${injection}${headTag[1]}</html>`;
        assertEqual(injectIntoHead(source, injection), output);
      });
    });
  });

  describe('exposeClosureState', function() {
    function instrumentModule<T>(source: string): T {
      const newSource = exposeClosureState("main.js", `(function(exports) { ${source} })(exports);`, true);
      // Super basic CommonJS shim.
      const exp: any = {};
      //console.log("Original Source:\n" + source);
      //console.log("\nNew Source:\n" + newSource);
      new Function('exports', AGENT_SOURCE + "\n" + newSource)(exp);
      return exp;
    }

    it('works with function declarations', function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        function decl(){}
        exports.decl = decl;
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.decl.__scope__['decl'], module.decl);
      module.decl.__scope__['a'] = 'no';
      assertEqual(module.decl.__scope__['a'], 'no');
      const arr = [1,2,3];
      module.decl.__scope__['a'] = arr;
      assertEqual(module.decl.__scope__['a'], arr);
    });

    it('works with function expressions', function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        exports.decl = function(){};
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.decl.__scope__['exports'].decl, module.decl);
    });

    it(`works with named function expressions`, function() {
      const module = instrumentModule<{decl: Function}>(`
        var a = 'hello';
        exports.decl = function decl2(){};
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
    });

    it(`works with multiple functions in the same block and multiple variables`, function() {
      const module = instrumentModule<{decl: Function, decl2: Function}>(`
        var a='hello';
        var b=3;
        exports.decl=function(){};
        exports.decl2=function(){};
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.decl2.__scope__['a'], 'hello');
      assertEqual(module.decl.__scope__['b'], 3);
      assertEqual(module.decl.__scope__['b'], 3);
    });

    it(`works with nested functions`, function() {
      const module = instrumentModule<{decl: Function, notDecl: Function}>(`
        var a = 'hello';
        function decl(){}
        function notDecl(){
          var decl = function decl(){};
          return decl;
        }
        exports.decl = decl;
        exports.notDecl = notDecl;
      `);
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.notDecl.__scope__['a'], 'hello');
      assertEqual(module.notDecl().__scope__['a'], 'hello');
    });

    it(`works with nested function declarations`, function() {
      const module = instrumentModule<{decl: Function, notDecl: Function}>(`
        var a = 'hello';
        function decl(){}
        function notDecl(){
          function decl(){}
          return decl;
        }
        exports.decl = decl;
        exports.notDecl = notDecl;
      `)
      assertEqual(module.decl.__scope__['a'], 'hello');
      assertEqual(module.notDecl.__scope__['a'], 'hello');
      assertEqual(module.notDecl().__scope__['a'], 'hello');
    });

    it(`works with functions in a list`, function() {
      const module = instrumentModule<{obj: {decl: Function, decl2: Function}}>(`
        var a = 'hello';
        exports.obj = {
          decl: function() {},
          decl2: function() {
            return 3
          }
        };
      `);
      assertEqual(module.obj.decl.__scope__['a'], 'hello');
      assertEqual(module.obj.decl2.__scope__['a'], 'hello');
    });
  });
});