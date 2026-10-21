package main

// 私信三件套：看私信列表、读聊天记录、回私信。由 install.sh 加进 xiaohongshu-mcp。

import (
	"context"

	"github.com/modelcontextprotocol/go-sdk/mcp"
	"github.com/sirupsen/logrus"
	"github.com/xpzouying/xiaohongshu-mcp/xiaohongshu"
)

type ListDMArgs struct {
	Limit int `json:"limit,omitempty" jsonschema:"最多返回几个会话，默认 20"`
}

type ReadDMArgs struct {
	UserID string `json:"user_id" jsonschema:"对方的 user_id，从 list_dm_chats 获取"`
	Limit  int    `json:"limit,omitempty" jsonschema:"最多返回几条消息，默认 20"`
}

type SendDMArgs struct {
	UserID  string `json:"user_id" jsonschema:"对方的 user_id，从 list_dm_chats 获取"`
	Content string `json:"content" jsonschema:"要发的话，纯文字，最多 500 字"`
}

func registerDMTools(server *mcp.Server, appServer *AppServer) {
	mcp.AddTool(server,
		&mcp.Tool{
			Name:        "list_dm_chats",
			Description: "看私信列表：谁私信过你、最后一句是什么、有几条没读。包括没互关的陌生人。user_id 用于 read_dm 和 send_dm。",
			Annotations: &mcp.ToolAnnotations{Title: "List DM Chats", ReadOnlyHint: true},
		},
		withPanicRecovery("list_dm_chats", func(ctx context.Context, req *mcp.CallToolRequest, args ListDMArgs) (*mcp.CallToolResult, any, error) {
			logrus.Infof("MCP: 私信列表 limit=%d", args.Limit)
			res, err := appServer.xiaohongshuService.ListDMChats(ctx, args.Limit)
			return convertToMCPResult(dmResult(res, err, "看私信列表")), nil, nil
		}),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name:        "read_dm",
			Description: "读和一个人的私信聊天记录（最新的在最后，from_me=true 是你发的）。会把这个会话标成已读。",
			Annotations: &mcp.ToolAnnotations{Title: "Read DM", ReadOnlyHint: true},
		},
		withPanicRecovery("read_dm", func(ctx context.Context, req *mcp.CallToolRequest, args ReadDMArgs) (*mcp.CallToolResult, any, error) {
			logrus.Infof("MCP: 读私信 user=%s", args.UserID)
			res, err := appServer.xiaohongshuService.ReadDM(ctx, args.UserID, args.Limit)
			return convertToMCPResult(dmResult(res, err, "读私信")), nil, nil
		}),
	)
	mcp.AddTool(server,
		&mcp.Tool{
			Name: "send_dm",
			Description: "回一条私信。只能发给私信列表里已经有的人（对方先私信过你），不能主动私信陌生人。" +
				"两条之间至少隔 25 秒，一天最多 40 条。verified=false 表示没确认到发出去。",
			Annotations: &mcp.ToolAnnotations{Title: "Send DM", DestructiveHint: boolPtr(true)},
		},
		withPanicRecovery("send_dm", func(ctx context.Context, req *mcp.CallToolRequest, args SendDMArgs) (*mcp.CallToolResult, any, error) {
			logrus.Infof("MCP: 发私信 user=%s", args.UserID)
			res, err := appServer.xiaohongshuService.SendDM(ctx, args.UserID, args.Content)
			return convertToMCPResult(dmResult(res, err, "发私信")), nil, nil
		}),
	)
	logrus.Infof("Registered 3 DM tools")
}

func dmResult(res any, err error, action string) *MCPToolResult {
	if err != nil {
		logrus.Warnf("%s失败: %v", action, err)
		return &MCPToolResult{Content: []MCPContent{{Type: "text", Text: action + "失败: " + err.Error()}}, IsError: true}
	}
	return marshalMCPResult(res, action)
}

func (s *XiaohongshuService) ListDMChats(ctx context.Context, limit int) (*xiaohongshu.DMChatList, error) {
	b := newBrowser()
	defer b.Close()
	page := b.NewPage()
	defer page.Close()
	return xiaohongshu.NewDMAction(page).List(ctx, limit)
}

func (s *XiaohongshuService) ReadDM(ctx context.Context, userID string, limit int) (*xiaohongshu.DMHistory, error) {
	b := newBrowser()
	defer b.Close()
	page := b.NewPage()
	defer page.Close()
	return xiaohongshu.NewDMAction(page).History(ctx, userID, limit)
}

func (s *XiaohongshuService) SendDM(ctx context.Context, userID, content string) (*xiaohongshu.DMSendResult, error) {
	b := newBrowser()
	defer b.Close()
	page := b.NewPage()
	defer page.Close()
	return xiaohongshu.NewDMAction(page).Send(ctx, userID, content)
}
