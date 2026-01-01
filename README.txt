LocalVision 7:3 Player (AUTO STORE v1.4.0)

✅ 이번 버전 특징
- config.json 없이, 접속 URL의 ?store= 값만으로 재생목록(playlist)을 자동으로 잡습니다.
- RIGHT(30%)는 공통(gongtong) 버킷을 기본으로 사용합니다.
- 신규 매장 추가 시 코드를 수정하지 않고, TV 주소에 leftBase=만 붙이면 됩니다.

📌 R2 업로드 규칙(중요)
- 각 매장(왼쪽 70%) 버킷/폴더에: left/playlist.json + left_*.jpg/mp4
- 공통(오른쪽 30%) 버킷/폴더에: right/playlist.json + right_*.jpg/mp4
- playlist.json은 "배열" 형태여야 합니다.

예) left/playlist.json
[
  { "url": "left_1.jpg", "duration": 10 },
  { "url": "left_2.jpg", "duration": 10 },
  { "url": "left_3.mp4" }
]

예) right/playlist.json
[
  { "url": "right_1.jpg", "duration": 10 },
  { "url": "right_2.jpg", "duration": 10 },
  { "url": "right_3.mp4" }
]

✅ 사용 방법(딱 2개)
1) 꽃집(sbflower):
   https://<YOUR_PAGES_URL>/?store=sbflower

2) 치킨(jtchiken):
   https://<YOUR_PAGES_URL>/?store=jtchiken

✅ 신규 매장(ppbunsick 등) 추가(코드 수정 X)
- 새 매장 버킷의 'Public URL(도메인)'만 알면 됩니다.
- TV 주소:
  https://<YOUR_PAGES_URL>/?store=ppbunsick&leftBase=https://pub-xxxx.r2.dev

(옵션) RIGHT 공통 버킷을 바꾸고 싶으면:
  ...&rightBase=https://pub-yyyy.r2.dev

⚠️ 영상이 안 나오면(대부분 CORS)
- R2 버킷 CORS에 GET/HEAD/OPTIONS 및 Range 헤더 허용이 필요합니다.

테스트 순서(오프라인 포함)
1) 인터넷 ON → 실행 → 1~2회 반복 재생(캐시 쌓기)
2) 인터넷 OFF → 새로고침(F5) → 저장된 콘텐츠면 계속 재생
