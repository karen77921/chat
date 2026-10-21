package xiaohongshu

// 私信（网页版消息页）。
//
// 读：不自己签名调接口，而是打开网页版私信页，让页面自己去请求，我们只读它拿回来的
// /api/im/... 响应——签名、风控参数都是页面自己算的，和真人打开一模一样。
// 写：在页面里点开那个人的会话，像真人一样打字、回车。
//
// 网页版私信页的地址和结构没有公开文档，所以这里多试几个地址；出错时把看到的接口和
// 页面地址带回错误信息里，方便对着真实页面调整。

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"os"
	"strings"
	"sync"
	"time"

	"github.com/go-rod/rod"
	"github.com/go-rod/rod/lib/input"
	"github.com/go-rod/rod/lib/proto"
	"github.com/sirupsen/logrus"
	"github.com/xpzouying/xiaohongshu-mcp/humanize"
)

// 网页版私信入口：不猜地址（/im 会一直挂着不回、/message 是 404），而是像人一样从首页、
// 通知页上找写着这些字的入口点进去。
var dmEntryLabels = []string{"私信", "消息"}

// DMChat 一个私信会话。
type DMChat struct {
	UserID       string `json:"user_id"`
	Nickname     string `json:"nickname"`
	LastMessage  string `json:"last_message"`
	LastTime     int64  `json:"last_time,omitempty"`
	Unread       int    `json:"unread,omitempty"`
	FollowStatus string `json:"follow_status,omitempty"`
}

// DMChatList 会话列表。
type DMChatList struct {
	Page  string   `json:"page"`
	Chats []DMChat `json:"chats"`
}

// DMMessage 一条私信。
type DMMessage struct {
	FromMe  bool   `json:"from_me"`
	Content string `json:"content"`
	Time    int64  `json:"time,omitempty"`
	Type    string `json:"type,omitempty"`
}

// DMHistory 和一个人的聊天记录（最新的在最后）。
type DMHistory struct {
	UserID   string      `json:"user_id"`
	Nickname string      `json:"nickname"`
	Messages []DMMessage `json:"messages"`
	// Raw 是没认出结构时原样带回的接口内容（截断），让调用方至少能看到在说什么。
	Raw string `json:"raw,omitempty"`
}

// DMSendResult 发送结果。
type DMSendResult struct {
	UserID   string `json:"user_id"`
	Nickname string `json:"nickname"`
	Sent     bool   `json:"sent"`
	Verified bool   `json:"verified"`
	Message  string `json:"message"`
}

// 发信节流：同一个进程里，两条私信至少隔这么久；一天最多这么多条。
const (
	dmMinGap   = 25 * time.Second
	dmDailyCap = 40
)

var dmThrottle = struct {
	sync.Mutex
	last  time.Time
	day   string
	count int
}{}

// DMAction 私信相关动作。
type DMAction struct {
	page *rod.Page
}

func NewDMAction(page *rod.Page) *DMAction {
	return &DMAction{page: page}
}

// capture 记下页面发出的 /api/ 请求，并留下 /api/im/ 响应的内容。
type capture struct {
	mu     sync.Mutex
	page   *rod.Page
	urls   []string
	bodies map[string]string // url -> body
	order  []string
}

// 页面关掉时监听自己结束。
func startCapture(page *rod.Page) *capture {
	c := &capture{page: page, bodies: map[string]string{}}
	_ = proto.NetworkEnable{}.Call(page)
	_ = proto.PageEnable{}.Call(page)
	wait := page.EachEvent(func(e *proto.PageJavascriptDialogOpening) {
		// 弹窗会把整页卡住（读不了字、跳转也不算完成）：记下它说了什么，关掉
		logrus.Warnf("私信页弹窗（%s）：%s", e.Type, e.Message)
		c.mu.Lock()
		c.urls = append(c.urls, "弹窗:"+e.Message)
		c.mu.Unlock()
		go func() { _ = proto.PageHandleJavaScriptDialog{Accept: true}.Call(page) }()
	}, func(e *proto.NetworkResponseReceived) {
		u := e.Response.URL
		if e.Type == proto.NetworkResourceTypeDocument {
			c.mu.Lock()
			c.urls = append(c.urls, fmt.Sprintf("页面:%s(%d)", shortURL(u), e.Response.Status))
			c.mu.Unlock()
		}
		if !strings.Contains(u, "/api/") {
			return
		}
		c.mu.Lock()
		c.urls = append(c.urls, shortURL(u))
		c.mu.Unlock()
		if !strings.Contains(u, "/im/") {
			return
		}
		go func(id proto.NetworkRequestID, u string) {
			// 响应体要等加载完才拿得到：稍等再取，取不到多试几次
			var res *proto.NetworkGetResponseBodyResult
			var err error
			for i := 0; i < 6; i++ {
				time.Sleep(400 * time.Millisecond)
				if res, err = (proto.NetworkGetResponseBody{RequestID: id}).Call(page); err == nil {
					break
				}
			}
			if err != nil {
				logrus.Warnf("私信接口 %s 的内容没取到: %v", shortURL(u), err)
				return
			}
			body := res.Body
			if res.Base64Encoded {
				if raw, err := base64.StdEncoding.DecodeString(body); err == nil {
					body = string(raw)
				}
			}
			c.mu.Lock()
			if _, ok := c.bodies[u]; !ok {
				c.order = append(c.order, u)
			}
			c.bodies[u] = body
			c.mu.Unlock()
		}(e.RequestID, u)
	})
	go wait()
	return c
}

func shortURL(u string) string {
	if i := strings.Index(u, "?"); i > 0 {
		u = u[:i]
	}
	return strings.TrimPrefix(strings.TrimPrefix(u, "https://edith.xiaohongshu.com"), "https://www.xiaohongshu.com")
}

// find 返回第一个 URL 里含 key 的 /im/ 响应。
func (c *capture) find(key string) (string, string) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, u := range c.order {
		if strings.Contains(u, key) {
			return u, c.bodies[u]
		}
	}
	return "", ""
}

// since 返回第 n 个之后新到的 /im/ 响应。
func (c *capture) since(n int) []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	var out []string
	for _, u := range c.order[min(n, len(c.order)):] {
		out = append(out, c.bodies[u])
	}
	return out
}

func (c *capture) count() int {
	c.mu.Lock()
	defer c.mu.Unlock()
	return len(c.order)
}

func (c *capture) seen() string {
	c.mu.Lock()
	defer c.mu.Unlock()
	uniq := map[string]bool{}
	var out []string
	for _, u := range c.urls {
		if !uniq[u] {
			uniq[u] = true
			out = append(out, u)
		}
	}
	if len(out) > 30 {
		out = out[len(out)-30:]
	}
	return strings.Join(out, ", ")
}

// openInbox 打开私信页，等到拿到会话列表的响应。整体不超过 35 秒——调用方（Imprint）
// 一个工具最多等 45 秒，还要算上开浏览器的时间，宁可快点报错带回线索。
func (d *DMAction) openInbox(ctx context.Context, c *capture) (string, string, error) {
	end := time.Now().Add(35 * time.Second)
	got := func(wait time.Duration) string {
		deadline := time.Now().Add(min(wait, time.Until(end)))
		for time.Now().Before(deadline) {
			if _, body := c.find("/chats"); body != "" {
				return body
			}
			if _, body := c.find("recent_chats"); body != "" {
				return body
			}
			time.Sleep(400 * time.Millisecond)
		}
		return ""
	}
	for _, start := range []string{"https://www.xiaohongshu.com/explore", "https://www.xiaohongshu.com/notification"} {
		if time.Until(end) < 6*time.Second {
			break
		}
		if err := d.page.Timeout(min(15*time.Second, time.Until(end))).Navigate(start); err != nil {
			logrus.Infof("私信入口：%s 还在加载（%v）", start, err)
		}
		_ = d.page.Timeout(min(8*time.Second, time.Until(end))).WaitLoad()
		if body := got(2 * time.Second); body != "" { // 有的页面一打开就带着会话列表
			return d.pageURL(), body, nil
		}
		logrus.Infof("私信入口：%s 上的入口有：%s", start, d.navLinks())
		for _, label := range dmEntryLabels {
			if !d.clickText(ctx, label) {
				continue
			}
			logrus.Infof("私信入口：在 %s 点了「%s」，现在在 %s", start, label, d.pageURL())
			if body := got(10 * time.Second); body != "" {
				return d.pageURL(), body, nil
			}
		}
	}
	shot := d.debugShot()
	text := d.pageText(200)
	logrus.Warnf("私信页排查：停在 %s；页面文字：%s；截图：%s；接口：%s", d.pageURL(), text, shot, c.seen())
	return "", "", fmt.Errorf("没在网页版里找到私信会话列表（停在 %s）。页面上的字：%s。页面请求过的接口：%s",
		d.pageURL(), text, c.seen())
}

// navLinks 页面上看得见的导航入口（文字 → 地址），给排查用。
func (d *DMAction) navLinks() string {
	res, err := d.page.Timeout(5 * time.Second).Eval(`() => [...document.querySelectorAll('a, [role="tab"], .reds-tab-item, li, .channel')]
		.filter((el) => { const r = el.getBoundingClientRect(); const t = (el.innerText || '').trim(); return r.width > 0 && t && t.length <= 8; })
		.map((el) => (el.innerText || '').trim() + (el.getAttribute('href') ? '→' + el.getAttribute('href') : ''))
		.filter((v, i, all) => all.indexOf(v) === i).slice(0, 40).join(' | ')`)
	if err != nil {
		return "?"
	}
	return res.Value.String()
}

// clickText 点页面上文字正好是 label（或以它开头、后面跟着未读数）且看得见的最小元素。
func (d *DMAction) clickText(ctx context.Context, label string) bool {
	elem, err := d.page.Timeout(4*time.Second).ElementByJS(rod.Eval(`(label) => {
		const ok = (t) => t === label || (t.startsWith(label) && /^\d*$/.test(t.slice(label.length).trim()));
		return [...document.querySelectorAll('body *')].find((el) => {
			if (el.children.length > 3) return false;
			const r = el.getBoundingClientRect();
			return r.width > 0 && r.height > 0 && ok((el.innerText || '').trim());
		}) || null;
	}`, label))
	if err != nil || elem == nil {
		return false
	}
	humanize.Delay(ctx, humanize.BeforeClick)
	if err := humanize.Click(elem); err != nil {
		logrus.Infof("私信入口：「%s」点不了：%v", label, err)
		return false
	}
	humanize.Delay(ctx, humanize.AfterClick)
	return true
}

// debugShot 把当前页面截图存到 /app/images/dm-debug.png（官方容器里这个目录挂在宿主机上）。
func (d *DMAction) debugShot() string {
	data, err := d.page.Timeout(10 * time.Second).Screenshot(false, nil)
	if err != nil {
		return "截图失败: " + err.Error()
	}
	path := "/app/images/dm-debug.png"
	if err := os.WriteFile(path, data, 0o644); err != nil {
		path = os.TempDir() + "/dm-debug.png"
		if err := os.WriteFile(path, data, 0o644); err != nil {
			return "截图存不下: " + err.Error()
		}
	}
	return path
}

func (d *DMAction) pageText(n int) string {
	res, err := d.page.Timeout(5*time.Second).Eval(`(n) => (document.body && document.body.innerText || '').replace(/\s+/g, ' ').slice(0, n)`, n)
	if err != nil {
		return "?"
	}
	return res.Value.String()
}

func (d *DMAction) pageURL() string {
	info, err := d.page.Timeout(3 * time.Second).Info()
	if err != nil || info == nil {
		return "?"
	}
	return info.URL
}

// List 读取私信会话列表。
func (d *DMAction) List(ctx context.Context, limit int) (*DMChatList, error) {
	if limit <= 0 {
		limit = 20
	}
	c := startCapture(d.page)
	where, body, err := d.openInbox(ctx, c)
	if err != nil {
		return nil, err
	}
	chats, err := parseChats(body)
	if err != nil {
		return nil, err
	}
	if len(chats) > limit {
		chats = chats[:limit]
	}
	return &DMChatList{Page: where, Chats: chats}, nil
}

// rawChats 是 /api/im/web/v3/chats（和旧版 get_recent_chats）的结构，两边字段都认。
type rawChats struct {
	Data struct {
		Chats    []rawChat `json:"chats"`
		UserList []rawChat `json:"user_list"`
	} `json:"data"`
}

type rawChat struct {
	ChatUserID  json.RawMessage `json:"chat_user_id"`
	UserID      json.RawMessage `json:"user_id"`
	Nickname    string          `json:"nickname"`
	LastContent string          `json:"last_msg_content"`
	LastTime    int64           `json:"last_msg_time"`
	Unread      int             `json:"unread_count"`
	UnreadCnt   int             `json:"unread_cnt"`
	Info        struct {
		Nickname     string `json:"nickname"`
		FollowStatus string `json:"follow_status"`
	} `json:"info"`
}

func rawID(parts ...json.RawMessage) string {
	for _, p := range parts {
		s := strings.Trim(strings.TrimSpace(string(p)), `"`)
		if s != "" && s != "null" {
			return s
		}
	}
	return ""
}

func parseChats(body string) ([]DMChat, error) {
	var raw rawChats
	if err := json.Unmarshal([]byte(body), &raw); err != nil {
		return nil, fmt.Errorf("会话列表解析失败: %w", err)
	}
	list := raw.Data.Chats
	if len(list) == 0 {
		list = raw.Data.UserList
	}
	out := make([]DMChat, 0, len(list))
	for _, ch := range list {
		name := ch.Info.Nickname
		if name == "" {
			name = ch.Nickname
		}
		out = append(out, DMChat{
			UserID:       rawID(ch.ChatUserID, ch.UserID),
			Nickname:     name,
			LastMessage:  readableContent(ch.LastContent),
			LastTime:     ch.LastTime,
			Unread:       max(ch.Unread, ch.UnreadCnt),
			FollowStatus: ch.Info.FollowStatus,
		})
	}
	return out, nil
}

// readableContent 消息内容有时是一段 JSON（{"content":"…"} 之类），取出里面的文字。
func readableContent(s string) string {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "{") {
		var m map[string]any
		if json.Unmarshal([]byte(s), &m) == nil {
			for _, k := range []string{"content", "text", "title", "desc"} {
				if v, ok := m[k].(string); ok && v != "" {
					return v
				}
			}
		}
	}
	return s
}

// openChat 在私信页里点开某个人的会话，返回他的昵称。
func (d *DMAction) openChat(ctx context.Context, c *capture, userID string) (string, error) {
	_, body, err := d.openInbox(ctx, c)
	if err != nil {
		return "", err
	}
	chats, err := parseChats(body)
	if err != nil {
		return "", err
	}
	var target *DMChat
	for i := range chats {
		if chats[i].UserID == userID {
			target = &chats[i]
			break
		}
	}
	if target == nil {
		return "", fmt.Errorf("私信列表里没有这个人（%s）：只能回给已经私信过你的人", userID)
	}
	if target.Nickname == "" {
		return "", fmt.Errorf("这个会话没有昵称，没法在页面上找到它")
	}

	// 找页面上文字正好是这个昵称、而且看得见的最小元素，点它
	elem, err := d.page.Timeout(15*time.Second).ElementByJS(rod.Eval(`(name) => {
		const all = [...document.querySelectorAll('body *')].filter((el) => {
			if (el.children.length > 2) return false;
			const t = (el.textContent || '').trim();
			if (t !== name) return false;
			const r = el.getBoundingClientRect();
			return r.width > 0 && r.height > 0;
		});
		return all[0] || null;
	}`, target.Nickname))
	if err != nil {
		return "", fmt.Errorf("页面上没找到「%s」这个会话：%w", target.Nickname, err)
	}
	humanize.Delay(ctx, humanize.BeforeClick)
	if err := humanize.Click(elem); err != nil {
		return "", fmt.Errorf("点开「%s」的会话失败: %w", target.Nickname, err)
	}
	humanize.Delay(ctx, humanize.AfterClick)
	return target.Nickname, nil
}

// History 读和一个人的聊天记录。
func (d *DMAction) History(ctx context.Context, userID string, limit int) (*DMHistory, error) {
	if limit <= 0 {
		limit = 20
	}
	c := startCapture(d.page)
	name, err := d.openChat(ctx, c, userID)
	if err != nil {
		return nil, err
	}
	// 等点开会话后的响应（会话列表里的条目没有 content 字段，不会被当成消息）
	var bodies []string
	deadline := time.Now().Add(10 * time.Second)
	for time.Now().Before(deadline) {
		bodies = c.since(0)
		if msgs := pickMessages(bodies, userID); len(msgs) > 0 {
			if len(msgs) > limit {
				msgs = msgs[len(msgs)-limit:]
			}
			return &DMHistory{UserID: userID, Nickname: name, Messages: msgs}, nil
		}
		time.Sleep(500 * time.Millisecond)
	}
	// 没认出结构：读页面上看得到的对话文字兜底
	text, _ := d.page.Eval(`() => {
		const box = [...document.querySelectorAll('[class*="message"], [class*="chat"]')]
			.sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
		return box ? box.innerText.slice(-3000) : '';
	}`)
	raw := ""
	if text != nil {
		raw = text.Value.String()
	}
	if raw == "" {
		return nil, fmt.Errorf("点开了「%s」的会话，但没读到聊天记录。页面请求过的接口：%s", name, c.seen())
	}
	return &DMHistory{UserID: userID, Nickname: name, Raw: raw}, nil
}

// pickMessages 在接口响应里找消息列表：一个对象数组，元素里有 content 和发送者。
func pickMessages(bodies []string, peer string) []DMMessage {
	for i := len(bodies) - 1; i >= 0; i-- {
		var root any
		if json.Unmarshal([]byte(bodies[i]), &root) != nil {
			continue
		}
		if msgs := walkMessages(root, peer); len(msgs) > 0 {
			return msgs
		}
	}
	return nil
}

func walkMessages(v any, peer string) []DMMessage {
	switch t := v.(type) {
	case map[string]any:
		for _, child := range t {
			if msgs := walkMessages(child, peer); len(msgs) > 0 {
				return msgs
			}
		}
	case []any:
		var out []DMMessage
		for _, it := range t {
			m, ok := it.(map[string]any)
			if !ok {
				return nil
			}
			content, ok := m["content"].(string)
			if !ok {
				return nil
			}
			sender := fmt.Sprint(firstOf(m, "sender_id", "from_user_id", "user_id"))
			out = append(out, DMMessage{
				FromMe:  sender != "" && sender != "<nil>" && sender != peer,
				Content: readableContent(content),
				Time:    toInt(firstOf(m, "created_at", "create_time", "time")),
				Type:    fmt.Sprint(firstOf(m, "type", "content_type")),
			})
		}
		if len(out) > 0 && looksNewestFirst(out) {
			for i, j := 0, len(out)-1; i < j; i, j = i+1, j-1 {
				out[i], out[j] = out[j], out[i]
			}
		}
		return out
	}
	return nil
}

func firstOf(m map[string]any, keys ...string) any {
	for _, k := range keys {
		if v, ok := m[k]; ok && v != nil {
			return v
		}
	}
	return nil
}

func toInt(v any) int64 {
	switch n := v.(type) {
	case float64:
		return int64(n)
	case string:
		var x int64
		fmt.Sscan(n, &x)
		return x
	}
	return 0
}

func looksNewestFirst(m []DMMessage) bool {
	return len(m) > 1 && m[0].Time > 0 && m[len(m)-1].Time > 0 && m[0].Time > m[len(m)-1].Time
}

// Send 回一条私信。只能发给私信列表里已有的人（他们先找过你）。
func (d *DMAction) Send(ctx context.Context, userID, content string) (*DMSendResult, error) {
	content = strings.TrimSpace(content)
	if content == "" {
		return nil, fmt.Errorf("私信内容是空的")
	}
	if len([]rune(content)) > 500 {
		return nil, fmt.Errorf("私信太长了（最多 500 字）")
	}
	if err := takeSendSlot(); err != nil {
		return nil, err
	}

	c := startCapture(d.page)
	name, err := d.openChat(ctx, c, userID)
	if err != nil {
		return nil, err
	}
	humanize.Delay(ctx, humanize.Reading)

	// 输入框：会话区里最靠下的、看得见的 textarea 或可编辑区域
	box, err := d.page.Timeout(15*time.Second).ElementByJS(rod.Eval(`() => {
		const all = [...document.querySelectorAll('textarea, [contenteditable="true"], input[type="text"]')]
			.filter((el) => { const r = el.getBoundingClientRect(); return r.width > 80 && r.height > 0; })
			.sort((a, b) => b.getBoundingClientRect().top - a.getBoundingClientRect().top);
		return all[0] || null;
	}`))
	if err != nil {
		return nil, fmt.Errorf("点开了「%s」的会话，但没找到输入框: %w", name, err)
	}
	humanize.Delay(ctx, humanize.BeforeClick)
	if err := humanize.Click(box); err != nil {
		return nil, fmt.Errorf("点输入框失败: %w", err)
	}
	if err := humanize.Type(ctx, box, content); err != nil {
		return nil, fmt.Errorf("打字失败: %w", err)
	}
	humanize.Delay(ctx, humanize.BeforeSubmit)

	// 有「发送」按钮就点按钮，没有就回车
	sendBtn, _ := d.page.Timeout(3 * time.Second).ElementByJS(rod.Eval(`() => {
		return [...document.querySelectorAll('button, [class*="send"]')]
			.find((el) => (el.textContent || '').trim() === '发送' && el.getBoundingClientRect().width > 0) || null;
	}`))
	if sendBtn != nil {
		err = humanize.Click(sendBtn)
	} else {
		err = d.page.Keyboard.Type(input.Enter)
	}
	if err != nil {
		return nil, fmt.Errorf("发送失败: %w", err)
	}
	humanize.Delay(ctx, humanize.AfterInteract)

	// 确认：输入框清空了，且页面上出现了这段话
	verified := false
	deadline := time.Now().Add(8 * time.Second)
	for time.Now().Before(deadline) {
		res, err := d.page.Eval(`(text) => {
			const left = [...document.querySelectorAll('textarea, [contenteditable="true"]')]
				.some((el) => ((el.value ?? el.textContent) || '').includes(text));
			return !left && document.body.innerText.includes(text);
		}`, content)
		if err == nil && res.Value.Bool() {
			verified = true
			break
		}
		time.Sleep(500 * time.Millisecond)
	}
	msg := "已发送"
	if !verified {
		msg = "按了发送，但没在页面上确认到这条消息，可能没发出去"
		logrus.Warnf("私信发送未确认 user=%s", userID)
	}
	return &DMSendResult{UserID: userID, Nickname: name, Sent: true, Verified: verified, Message: msg}, nil
}

func takeSendSlot() error {
	dmThrottle.Lock()
	defer dmThrottle.Unlock()
	now := time.Now()
	today := now.Format("2006-01-02")
	if dmThrottle.day != today {
		dmThrottle.day, dmThrottle.count = today, 0
	}
	if dmThrottle.count >= dmDailyCap {
		return fmt.Errorf("今天已经发了 %d 条私信，到上限了，明天再发", dmThrottle.count)
	}
	if wait := dmMinGap - now.Sub(dmThrottle.last); wait > 0 {
		return fmt.Errorf("刚发过一条，%d 秒后再发（发太快像机器）", int(wait.Seconds())+1)
	}
	dmThrottle.last, dmThrottle.count = now, dmThrottle.count+1
	return nil
}
