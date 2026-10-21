package xiaohongshu

import "testing"

func TestParseChats(t *testing.T) {
	body := `{"data":{"chats":[{"chat_user_id":"u1","last_msg_content":"{\"content\":\"你好呀\"}","last_msg_time":1700000000000,"unread_count":2,"info":{"nickname":"小兔","follow_status":"NONE"}}]}}`
	chats, err := parseChats(body)
	if err != nil || len(chats) != 1 {
		t.Fatalf("got %v %v", chats, err)
	}
	c := chats[0]
	if c.UserID != "u1" || c.Nickname != "小兔" || c.LastMessage != "你好呀" || c.Unread != 2 || c.FollowStatus != "NONE" {
		t.Fatalf("bad chat %+v", c)
	}
	old, _ := parseChats(`{"data":{"user_list":[{"user_id":"u2","nickname":"旧版","last_msg_content":"hi"}]}}`)
	if len(old) != 1 || old[0].UserID != "u2" || old[0].Nickname != "旧版" {
		t.Fatalf("old shape %+v", old)
	}
}

func TestPickMessages(t *testing.T) {
	chats := `{"data":{"chats":[{"chat_user_id":"u1","last_msg_content":"x"}]}}`
	hist := `{"data":{"message_list":[{"sender_id":"me9","content":"在的","created_at":200},{"sender_id":"u1","content":"{\"content\":\"在吗\"}","created_at":100}]}}`
	msgs := pickMessages([]string{chats, hist}, "u1")
	if len(msgs) != 2 || msgs[0].Content != "在吗" || msgs[0].FromMe || !msgs[1].FromMe {
		t.Fatalf("got %+v", msgs)
	}
	if got := pickMessages([]string{chats}, "u1"); len(got) != 0 {
		t.Fatalf("chat list mistaken for messages: %+v", got)
	}
}
