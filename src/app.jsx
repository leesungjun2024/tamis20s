import React, { useState, useRef, useEffect } from 'react';
import WaveSurfer from 'wavesurfer.js';
import { supabase } from './supabaseClient';

export default function App() {
  // --- 인증 및 세션 상태 ---
  const [user, setUser] = useState(null);
  const [userRole, setUserRole] = useState('portfolio_admin'); // 'system_admin' | 'portfolio_admin'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [isSignUp, setIsSignUp] = useState(false);

  // --- 뷰 및 네비게이션 상태 ('dashboard' | 'portfolio' | 'studio') ---
  const [activeTab, setActiveTab] = useState('dashboard');
  const [workgroups, setWorkgroups] = useState([]);
  const [currentRoom, setCurrentRoom] = useState(null);
  const [filterStatus, setFilterStatus] = useState('all');

  // --- 모바일 중복 생성 방지 플래그 ---
  const [isCreatingRoom, setIsCreatingRoom] = useState(false);

  // --- 일괄 삭제 선택 ID 상태 ---
  const [selectedWorkgroupRoomIds, setSelectedWorkgroupRoomIds] = useState([]);
  const [selectedPortfolioItemIds, setSelectedPortfolioItemIds] = useState([]);

  // --- 플레이어 및 오디오 상태 ---
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // --- 코멘트 및 타임스탬프 상태 ---
  const [comments, setComments] = useState([]);
  const [newCommentText, setNewCommentText] = useState('');
  const [authorName, setAuthorName] = useState('관리자');
  const [selectedTrackId, setSelectedTrackId] = useState('');
  const [isStamping, setIsStamping] = useState(true); // 스탬프 켜기 DEFAULT
  const [stampTime, setStampTime] = useState(0);

  // --- 포트폴리오 테마 ('light' | 'dark' | 'warm') ---
  const [portfolioTheme, setPortfolioTheme] = useState('light');

  const wavesurferRefs = useRef({});
  const containerRefs = useRef({});
  const commentInputRef = useRef(null);

  // --- Supabase 초기화 및 권한별 데이터 로드 ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        determineUserRoleAndFetch(currentUser);
        setAuthorName(currentUser.email.split('@')[0]);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      const currentUser = session?.user ?? null;
      setUser(currentUser);
      if (currentUser) {
        determineUserRoleAndFetch(currentUser);
        setAuthorName(currentUser.email.split('@')[0]);
      }
    });

    fetchComments();

    const channel = supabase
      .channel('public:all-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'feedbacks' }, () => {
        fetchComments();
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
      subscription.unsubscribe();
    };
  }, []);

  // --- 관리자 권한 판별 및 데이터 조회 함수 ---
  const determineUserRoleAndFetch = async (currentUser) => {
    // 시스템 관리자 이메일 목록 또는 DB 권한 테이블 대조 (여기서는 예시로 admin 이메일 판별 및 닉네임 확인)
    const isSystemAdmin = currentUser.email.includes('admin') || currentUser.email === 'krsungjun@gmail.com';
    const role = isSystemAdmin ? 'system_admin' : 'portfolio_admin';
    setUserRole(role);

    fetchWorkgroups(currentUser, role);
  };

  useEffect(() => {
    if (currentRoom?.tracks && currentRoom.tracks.length > 0) {
      setSelectedTrackId(currentRoom.tracks[0].id);
    } else {
      setSelectedTrackId('');
    }
  }, [currentRoom]);

  const handleAuth = async (e) => {
    e.preventDefault();
    if (isSignUp) {
      const { error } = await supabase.auth.signUp({ email, password });
      if (error) alert(error.message);
      else alert('회원가입 성공! 로그인해주세요.');
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) alert(error.message);
    }
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    setUser(null);
  };

  // --- 권한 정책이 적용된 작업방 조회 (시스템 관리자 vs 포트폴리오 관리자) ---
  const fetchWorkgroups = async (currentUser, role) => {
    let query = supabase
      .from('workgroups')
      .select('*, tracks(*), workgroup_members(*)')
      .order('created_at', { ascending: false });

    // 포트폴리오 관리자일 경우: 자신이 생성한 방 또는 멤버로 속한 방만 필터링
    if (role === 'portfolio_admin') {
      // Supabase RLS 또는 쿼리 조건: user_id가 같거나 workgroup_members에 포함된 경우
      query = query.or(`user_id.eq.${currentUser.id}`);
    }

    const { data, error } = await query;

    if (!error && data) {
      setWorkgroups(data);
      if (data.length > 0 && !currentRoom) {
        setCurrentRoom(data[0]);
      } else if (data.length === 0) {
        setCurrentRoom(null);
      }
    }
  };

  const fetchComments = async () => {
    const { data, error } = await supabase
      .from('feedbacks')
      .select('*')
      .order('start_time', { ascending: true });

    if (!error) {
      setComments(data || []);
    }
  };

  // --- 모바일 터치 중복 실행 방지(isCreatingRoom)가 적용된 작업방 생성 ---
  const handleCreateWorkgroup = async () => {
    if (!user || isCreatingRoom) return;
    const title = prompt('새 작업방(프로젝트) 이름을 입력하세요:', '모바일 첫번째11');
    if (!title) return;

    setIsCreatingRoom(true);

    try {
      const { data, error } = await supabase
        .from('workgroups')
        .insert([{ workgroup_name: title, user_id: user.id, description: 'Work in progress', view_yn: 'Y', del_yn: 'N' }])
        .select()
        .single();

      if (!error && data) {
        // 생성된 작업방에 기본 관리자(현재 유저)를 멤버로 자동 등록
        await supabase.from('workgroup_members').insert([{
          workgroup_id: data.id,
          user_id: user.id,
          role: userRole
        }]);

        await supabase.from('tracks').insert([{
          workgroup_id: data.id,
          track_name: '기본 샘플 음원',
          filename: 'sample.mp3',
          file_url: 'https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg',
          duration: 48,
          uploader_type: 'mine'
        }]);

        alert(`"${title}" 작업방이 생성되었습니다!`);
        await fetchWorkgroups(user, userRole);
        
        const { data: updatedRooms } = await supabase.from('workgroups').select('*, tracks(*), workgroup_members(*)').eq('id', data.id).single();
        if (updatedRooms) setCurrentRoom(updatedRooms);
        setActiveTab('studio');
      } else {
        alert('작업방 생성 실패: ' + error?.message);
      }
    } finally {
      setIsCreatingRoom(false);
    }
  };

  const handleUpdateWorkgroupName = async (newName) => {
    if (!currentRoom) return;
    const { error } = await supabase
      .from('workgroups')
      .update({ workgroup_name: newName })
      .eq('id', currentRoom.id);

    if (!error) {
      setCurrentRoom(prev => ({ ...prev, workgroup_name: newName }));
      fetchWorkgroups(user, userRole);
    }
  };

  const handleToggleRoomStatus = async () => {
    if (!currentRoom) return;
    const nextStatus = currentRoom.description === 'Done' ? 'Work in progress' : 'Done';
    const { error } = await supabase
      .from('workgroups')
      .update({ description: nextStatus })
      .eq('id', currentRoom.id);

    if (!error) {
      setCurrentRoom(prev => ({ ...prev, description: nextStatus }));
      fetchWorkgroups(user, userRole);
    }
  };

  const handleDeleteWorkgroup = async (roomId) => {
    if (!confirm('정말 이 작업방을 삭제하시겠습니까?')) return;
    const { error } = await supabase.from('workgroups').delete().eq('id', roomId);
    if (!error) {
      alert('작업방이 삭제되었습니다.');
      fetchWorkgroups(user, userRole);
      setCurrentRoom(null);
      setActiveTab('dashboard');
    } else {
      alert('삭제 실패: ' + error.message);
    }
  };

  // --- 작업방 일괄 삭제 핸들러 ---
  const handleBulkDeleteWorkgroups = async () => {
    if (selectedWorkgroupRoomIds.length === 0) {
      alert('삭제할 작업방을 체크해 주세요.');
      return;
    }
    if (!confirm(`선택한 ${selectedWorkgroupRoomIds.length}개의 작업방을 정말 일괄 삭제하시겠습니까?`)) return;

    const { error } = await supabase
      .from('workgroups')
      .delete()
      .in('id', selectedWorkgroupRoomIds);

    if (!error) {
      alert('선택한 작업방들이 일괄 삭제되었습니다.');
      setSelectedWorkgroupRoomIds([]);
      fetchWorkgroups(user, userRole);
      setCurrentRoom(null);
    } else {
      alert('작업방 일괄 삭제 실패: ' + error.message);
    }
  };

  // --- 포트폴리오 독립 일괄 삭제 핸들러 ---
  const handleBulkDeletePortfolios = async () => {
    if (selectedPortfolioItemIds.length === 0) {
      alert('삭제할 포트폴리오 항목을 체크해 주세요.');
      return;
    }
    if (!confirm(`선택한 ${selectedPortfolioItemIds.length}개의 포트폴리오 항목을 정말 일괄 삭제하시겠습니까?`)) return;

    const { error } = await supabase
      .from('workgroups')
      .delete()
      .in('id', selectedPortfolioItemIds);

    if (!error) {
      alert('선택한 포트폴리오 항목들이 일괄 삭제되었습니다.');
      setSelectedPortfolioItemIds([]);
      fetchWorkgroups(user, userRole);
    } else {
      alert('포트폴리오 일괄 삭제 실패: ' + error.message);
    }
  };

  const handleToggleSelectWorkgroup = (roomId, e) => {
    e.stopPropagation(); 
    if (selectedWorkgroupRoomIds.includes(roomId)) {
      setSelectedWorkgroupRoomIds(selectedWorkgroupRoomIds.filter(id => id !== roomId));
    } else {
      setSelectedWorkgroupRoomIds([...selectedWorkgroupRoomIds, roomId]);
    }
  };

  const handleToggleSelectPortfolio = (roomId, e) => {
    e.stopPropagation(); 
    if (selectedPortfolioItemIds.includes(roomId)) {
      setSelectedPortfolioItemIds(selectedPortfolioItemIds.filter(id => id !== roomId));
    } else {
      setSelectedPortfolioItemIds([...selectedPortfolioItemIds, roomId]);
    }
  };

  const handleUploadTrack = async (e) => {
    const file = e.target.files[0];
    if (!file || !currentRoom) return;

    const fileExt = file.name.split('.').pop();
    const fileName = `${crypto.randomUUID()}.${fileExt}`;
    const filePath = `${currentRoom.id}/${fileName}`;

    const { error: uploadErr } = await supabase.storage.from('tracks').upload(filePath, file);
    
    let publicUrl = '';
    if (uploadErr) {
      publicUrl = URL.createObjectURL(file);
    } else {
      const { data: urlData } = supabase.storage.from('tracks').getPublicUrl(filePath);
      publicUrl = urlData.publicUrl;
    }

    const { error: insertErr } = await supabase.from('tracks').insert([{
      workgroup_id: currentRoom.id,
      track_name: file.name,
      filename: file.name,
      file_url: publicUrl,
      duration: 48,
      uploader_type: 'mine'
    }]);

    if (!insertErr) {
      alert('새 버전 음원이 성공적으로 등록되었습니다!');
      const { data: refreshedRoom } = await supabase.from('workgroups').select('*, tracks(*), workgroup_members(*)').eq('id', currentRoom.id).single();
      if (refreshedRoom) setCurrentRoom(refreshedRoom);
      fetchWorkgroups(user, userRole);
    } else {
      alert('트랙 DB 저장 실패: ' + insertErr.message);
    }
  };

  useEffect(() => {
    const tracks = currentRoom?.tracks || [];
    
    Object.values(wavesurferRefs.current).forEach(ws => ws?.destroy());
    wavesurferRefs.current = {};

    tracks.forEach((track) => {
      const container = containerRefs.current[track.id];
      if (!container) return;

      const audioUrl = track.file_url || 'https://actions.google.com/sounds/v1/ambiences/rain_heavy.ogg';

      const ws = WaveSurfer.create({
        container: container,
        url: audioUrl,
        waveColor: '#cbd5e1',
        progressColor: '#2e605d',
        cursorColor: '#1c1b18',
        height: 54,
        barWidth: 3,
        barGap: 2,
        barRadius: 2,
      });

      wavesurferRefs.current[track.id] = ws;

      ws.on('ready', () => {
        const dur = ws.getDuration();
        if (dur > duration) setDuration(dur);
      });

      ws.on('audioprocess', () => {
        setCurrentTime(ws.getCurrentTime());
      });

      ws.on('interaction', () => {
        const clickedTime = ws.getCurrentTime();
        setCurrentTime(clickedTime);

        if (isStamping) {
          if (ws.isPlaying()) {
            ws.pause();
            setIsPlaying(false);
          } else {
            ws.play();
            setIsPlaying(true);
          }
        } else {
          setIsPlaying(false);
          Object.values(wavesurferRefs.current).forEach(w => w?.pause());

          setSelectedTrackId(track.id);
          setStampTime(Number(clickedTime.toFixed(2)));

          if (commentInputRef.current) {
            commentInputRef.current.focus();
          }
        }
      });

      ws.on('finish', () => {
        setIsPlaying(false);
      });
    });

    return () => {
      Object.values(wavesurferRefs.current).forEach(ws => ws?.destroy());
    };
  }, [currentRoom, isStamping]);

  const togglePlayAll = () => {
    const nextState = !isPlaying;
    setIsPlaying(nextState);

    Object.values(wavesurferRefs.current).forEach(ws => {
      if (ws) {
        if (nextState) ws.play();
        else ws.pause();
      }
    });
  };

  const handleSeek = (seconds) => {
    setCurrentTime(seconds);
    Object.values(wavesurferRefs.current).forEach(ws => {
      if (ws) ws.setTime(seconds);
    });
  };

  const handleToggleStamping = () => {
    const nextStamping = !isStamping;
    setIsStamping(nextStamping);

    if (!nextStamping) {
      setIsPlaying(false);
      Object.values(wavesurferRefs.current).forEach(ws => ws?.pause());
      setStampTime(Number(currentTime.toFixed(2)));
    }
  };

  const handleAddComment = async (e) => {
    e.preventDefault();
    if (!newCommentText.trim() || !user) return;

    const commentPayload = {
      track_id: selectedTrackId || null,
      user_id: user.id,
      author: authorName,
      content: newCommentText,
      start_time: !isStamping ? Number(stampTime) : Number(currentTime.toFixed(2)),
      resolved: false
    };

    const { error } = await supabase.from('feedbacks').insert([commentPayload]);

    if (!error) {
      setNewCommentText('');
      fetchComments();
      alert('코멘트가 성공적으로 저장되었습니다!');
    } else {
      console.error('Feedback insert error:', error);
      alert('코멘트 등록 실패: ' + error.message);
    }
  };

  const handleToggleResolve = async (commentId, currentStatus) => {
    await supabase.from('feedbacks').update({ resolved: !currentStatus }).eq('id', commentId);
    fetchComments();
  };

  const handleDeleteComment = async (commentId) => {
    if (!confirm('이 코멘트를 삭제하시겠습니까?')) return;
    await supabase.from('feedbacks').delete().eq('id', commentId);
    fetchComments();
  };

  const formatTime = (secs) => {
    if (isNaN(secs)) return '0:00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
  };

  const filteredWorkgroups = workgroups.filter(room => {
    const isDone = room.description === 'Done';
    if (filterStatus === 'progress') return !isDone;
    if (filterStatus === 'done') return isDone;
    return true;
  });

  if (!user) {
    return (
      <div style={{ maxWidth: '420px', margin: '80px auto', padding: '35px', background: '#fff', borderRadius: '20px', boxShadow: '0 10px 25px rgba(0,0,0,0.05)', fontFamily: 'sans-serif', border: '1px solid #e2e8f0' }}>
        <div style={{ textAlign: 'center', marginBottom: '25px' }}>
          <span style={{ fontSize: '28px', fontWeight: '800', color: '#1c1b18' }}>tami<span style={{ color: '#2e605d' }}>✳</span> 관리자 패널</span>
          <p style={{ fontSize: '13px', color: '#666', marginTop: '6px' }}>권한 정책 적용 버전</p>
        </div>
        <form onSubmit={handleAuth} style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          <input type="email" placeholder="관리자 이메일" value={email} onChange={(e) => setEmail(e.target.value)} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid #c2bfb3', fontSize: '13px', background: '#f7f6f0' }} required />
          <input type="password" placeholder="비밀번호" value={password} onChange={(e) => setPassword(e.target.value)} style={{ padding: '12px 14px', borderRadius: '10px', border: '1px solid #c2bfb3', fontSize: '13px', background: '#f7f6f0' }} required />
          <button type="submit" style={{ padding: '14px', background: '#1c1b18', color: '#fff', border: 'none', borderRadius: '10px', fontWeight: '600', cursor: 'pointer', fontSize: '14px' }}>
            {isSignUp ? '관리자 가입하기' : '관리자 로그인'}
          </button>
        </form>
      </div>
    );
  }

  return (
    <div style={{ maxWidth: '1200px', margin: '20px auto', padding: '25px', background: portfolioTheme === 'dark' ? '#121212' : portfolioTheme === 'warm' ? '#fdfbf7' : '#fcfbf9', color: portfolioTheme === 'dark' ? '#f3f4f6' : '#1c1b18', borderRadius: '20px', boxShadow: '0 10px 30px rgba(0,0,0,0.06)', fontFamily: 'sans-serif' }}>
      
      {/* 상단 관리자 네비게이션 및 권한 뱃지 표시 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '14px 20px', background: portfolioTheme === 'dark' ? '#1e1e1e' : '#fff', borderRadius: '14px', border: '1px solid #c8c5b8', flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '20px', fontWeight: '800' }}>tami<span style={{ color: '#2e605d' }}>✳</span> 관리자 스튜디오</span>
          <span style={{ fontSize: '12px', background: userRole === 'system_admin' ? '#1c1b18' : '#2e605d', color: '#fff', padding: '2px 8px', borderRadius: '6px', fontWeight: '600' }}>
            {userRole === 'system_admin' ? '🛡️ system_admin (전체 권한)' : '🎵 portfolio_admin (소속 작업방 한정)'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button onClick={() => setActiveTab('dashboard')} style={{ padding: '8px 14px', background: activeTab === 'dashboard' ? '#1c1b18' : '#f7f6f0', color: activeTab === 'dashboard' ? '#fff' : '#333', border: '1px solid #c8c5b8', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>
            📂 작업방 목록
          </button>
          <button onClick={() => setActiveTab('portfolio')} style={{ padding: '8px 14px', background: activeTab === 'portfolio' ? '#2e605d' : '#f7f6f0', color: activeTab === 'portfolio' ? '#fff' : '#333', border: '1px solid #c8c5b8', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>
            🎵 포트폴리오 목록보기
          </button>
          <button onClick={() => setActiveTab('studio')} style={{ padding: '8px 14px', background: activeTab === 'studio' ? '#1c1b18' : '#f7f6f0', color: activeTab === 'studio' ? '#fff' : '#333', border: '1px solid #c8c5b8', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>
            🎛️ 작업방 상세 편집
          </button>
          <button onClick={handleLogout} style={{ padding: '8px 12px', background: '#e53935', color: '#fff', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px' }}>
            SIGN OUT
          </button>
        </div>
      </div>

      {/* 📂 작업방 목록 뷰 */}
      {activeTab === 'dashboard' ? (
        <div style={{ padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '24px', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', gap: '10px' }}>
              <button onClick={() => setFilterStatus('all')} style={{ padding: '8px 18px', background: filterStatus === 'all' ? '#1c1b18' : '#e2dfd2', color: filterStatus === 'all' ? '#fff' : '#333', border: 'none', borderRadius: '20px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
                전체 {workgroups.length}
              </button>
              <button onClick={() => setFilterStatus('progress')} style={{ padding: '8px 18px', background: filterStatus === 'progress' ? '#1c1b18' : '#e2dfd2', color: filterStatus === 'progress' ? '#fff' : '#333', border: 'none', borderRadius: '20px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
                진행 중 {workgroups.filter(w => w.description !== 'Done').length}
              </button>
              <button onClick={() => setFilterStatus('done')} style={{ padding: '8px 18px', background: filterStatus === 'done' ? '#1c1b18' : '#e2dfd2', color: filterStatus === 'done' ? '#fff' : '#333', border: 'none', borderRadius: '20px', fontWeight: '700', fontSize: '13px', cursor: 'pointer' }}>
                완료 {workgroups.filter(w => w.description === 'Done').length}
              </button>
            </div>

            <div style={{ display: 'flex', gap: '10px' }}>
              {selectedWorkgroupRoomIds.length > 0 && (
                <button 
                  onClick={handleBulkDeleteWorkgroups}
                  style={{ padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer' }}
                >
                  🗑️ 선택한 작업방 일괄 삭제 ({selectedWorkgroupRoomIds.length})
                </button>
              )}
              <button onClick={handleCreateWorkgroup} disabled={isCreatingRoom} style={{ padding: '8px 16px', background: '#2e605d', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', fontSize: '12px', cursor: 'pointer', opacity: isCreatingRoom ? 0.6 : 1 }}>
                {isCreatingRoom ? '생성 중...' : '+ 새 작업방 만들기'}
              </button>
            </div>
          </div>

          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <h3 style={{ fontSize: '16px', fontWeight: '800', margin: 0 }}>
              {userRole === 'system_admin' ? '🛡️ [전체] 우리의 음악이 자라는 곳' : '🎵 [소속] 내가 참여중인 작업방'}
            </h3>
            <span style={{ fontSize: '12px', color: '#666', fontWeight: '700' }}>{filteredWorkgroups.length} PROJECTS</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '20px' }}>
            {filteredWorkgroups.map((room) => {
              const roomCommentsCount = comments.filter(c => {
                const targetTrack = room.tracks?.find(t => t.id === c.track_id);
                return targetTrack !== undefined;
              }).length;
              const isDone = room.description === 'Done';
              const isChecked = selectedWorkgroupRoomIds.includes(room.id);

              return (
                <div 
                  key={room.id} 
                  onClick={() => { setCurrentRoom(room); setActiveTab('studio'); }} 
                  style={{ 
                    background: portfolioTheme === 'dark' ? '#1e1e1e' : '#fff', 
                    padding: '18px', 
                    borderRadius: '16px', 
                    border: isChecked ? '2px solid #2e605d' : '1px solid #c8c5b8', 
                    cursor: 'pointer',
                    position: 'relative',
                    transition: 'all 0.2s'
                  }}
                >
                  <div 
                    onClick={(e) => handleToggleSelectWorkgroup(room.id, e)}
                    style={{ position: 'absolute', top: '22px', right: '22px', zIndex: 10, padding: '6px' }}
                  >
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      onChange={(e) => handleToggleSelectWorkgroup(room.id, e)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2e605d' }}
                      title="선택하여 작업방 삭제"
                    />
                  </div>

                  <div style={{ width: '100%', height: '180px', background: '#1c1b18', borderRadius: '12px', position: 'relative', marginBottom: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ position: 'absolute', top: '12px', left: '12px', background: 'rgba(0,0,0,0.6)', color: '#fff', padding: '4px 10px', borderRadius: '20px', fontSize: '11px', fontWeight: '700', display: 'flex', alignItems: 'center', gap: '5px' }}>
                      <span style={{ width: '6px', height: '6px', background: isDone ? '#10b981' : '#d4ed31', borderRadius: '50%' }}></span>
                      {isDone ? '✓ 작업 완료' : '● 진행 중'}
                    </div>
                    <span style={{ color: '#fff', fontSize: '18px', fontWeight: '800', padding: '0 20px', textAlign: 'center' }}>{room.workgroup_name}</span>
                  </div>
                  <h4 style={{ fontSize: '16px', fontWeight: '800', margin: '0 0 8px 0' }}>{room.workgroup_name}</h4>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontSize: '12px', color: '#666', fontWeight: '600' }}>{roomCommentsCount > 0 ? `코멘트 ${roomCommentsCount}개` : '첫 아이디어를 기다려요'}</span>
                    <span style={{ fontSize: '11px', background: '#e2dfd2', padding: '2px 8px', borderRadius: '4px', fontWeight: '700' }}>트랙 {room.tracks?.length || 0}개</span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : activeTab === 'portfolio' ? (
        /* 🎵 포트폴리오 목록보기 뷰 */
        <div style={{ padding: '10px 0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '25px', flexWrap: 'wrap', gap: '15px', background: portfolioTheme === 'dark' ? '#1e1e1e' : '#fff', padding: '20px', borderRadius: '16px', border: '1px solid #c8c5b8' }}>
            <div>
              <h2 style={{ fontSize: '22px', fontWeight: '800', margin: '0 0 4px 0' }}>🎨 아티스트 포트폴리오 갤러리</h2>
              <p style={{ fontSize: '13px', color: '#666', margin: 0 }}>
                {userRole === 'system_admin' ? '🛡️ 전체 포트폴리오 관리 권한' : '🎵 내가 속한 작업방 포트폴리오 권한'}
              </p>
            </div>
            <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
              {selectedPortfolioItemIds.length > 0 && (
                <button 
                  onClick={handleBulkDeletePortfolios}
                  style={{ padding: '8px 16px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                >
                  🗑️ 선택한 포트폴리오 일괄 삭제 ({selectedPortfolioItemIds.length})
                </button>
              )}
              <div style={{ display: 'flex', gap: '6px' }}>
                <button onClick={() => setPortfolioTheme('light')} style={{ padding: '6px 12px', background: portfolioTheme === 'light' ? '#2e605d' : '#f7f6f0', color: portfolioTheme === 'light' ? '#fff' : '#333', border: '1px solid #c2bfb3', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Light</button>
                <button onClick={() => setPortfolioTheme('warm')} style={{ padding: '6px 12px', background: portfolioTheme === 'warm' ? '#2e605d' : '#f7f6f0', color: portfolioTheme === 'warm' ? '#fff' : '#333', border: '1px solid #c2bfb3', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Warm</button>
                <button onClick={() => setPortfolioTheme('dark')} style={{ padding: '6px 12px', background: portfolioTheme === 'dark' ? '#2e605d' : '#f7f6f0', color: portfolioTheme === 'dark' ? '#fff' : '#333', border: '1px solid #c2bfb3', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}>Dark</button>
              </div>
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {workgroups.map((room, idx) => {
              const isDone = room.description === 'Done';
              const tracks = room.tracks || [];
              const isChecked = selectedPortfolioItemIds.includes(room.id);

              return (
                <div 
                  key={room.id} 
                  style={{ 
                    background: portfolioTheme === 'dark' ? '#1e1e1e' : '#fff', 
                    padding: '24px', 
                    borderRadius: '16px', 
                    border: isChecked ? '2px solid #2e605d' : '1px solid #c8c5b8', 
                    display: 'flex', 
                    flexDirection: 'column', 
                    gap: '16px',
                    position: 'relative'
                  }}
                >
                  <div 
                    onClick={(e) => handleToggleSelectPortfolio(room.id, e)}
                    style={{ position: 'absolute', top: '24px', right: '24px', zIndex: 10, padding: '6px' }}
                  >
                    <input 
                      type="checkbox" 
                      checked={isChecked} 
                      onChange={(e) => handleToggleSelectPortfolio(room.id, e)}
                      style={{ width: '18px', height: '18px', cursor: 'pointer', accentColor: '#2e605d' }}
                      title="선택하여 포트폴리오 삭제"
                    />
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '10px', paddingRight: '40px' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                        <span style={{ fontSize: '11px', background: isDone ? '#10b981' : '#2e605d', color: '#fff', padding: '2px 8px', borderRadius: '12px', fontWeight: '700' }}>
                          {isDone ? '✓ RELEASED / 완료' : '● IN PROGRESS / 진행 중'}
                        </span>
                        <span style={{ fontSize: '12px', color: '#666', fontWeight: '600' }}>PROJECT #{workgroups.length - idx}</span>
                      </div>
                      <h3 style={{ fontSize: '20px', fontWeight: '800', margin: 0 }}>{room.workgroup_name}</h3>
                    </div>
                    <button 
                      onClick={() => { setCurrentRoom(room); setActiveTab('studio'); }}
                      style={{ padding: '8px 16px', background: '#1c1b18', color: '#fff', border: 'none', borderRadius: '8px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      🎛️ 스튜디오에서 열기 & 코멘트 보기
                    </button>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: '12px' }}>
                    {tracks.length > 0 ? (
                      tracks.map((track, tIdx) => (
                        <div key={track.id} style={{ background: portfolioTheme === 'dark' ? '#252525' : '#f7f6f0', padding: '14px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                          <span style={{ fontSize: '12px', fontWeight: '700', color: '#2e605d', display: 'block', marginBottom: '6px' }}>
                            🎵 버전 v{tIdx + 1} : {track.track_name || track.filename}
                          </span>
                          <audio controls src={track.file_url} style={{ width: '100%', height: '32px' }} />
                        </div>
                      ))
                    ) : (
                      <div style={{ fontSize: '13px', color: '#666', fontStyle: 'italic' }}>등록된 음원 트랙이 없습니다.</div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        /* 🎛️ 작업방 상세 편집 스튜디오 뷰 */
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', padding: '14px 18px', background: portfolioTheme === 'dark' ? '#1e1e1e' : '#fff', borderRadius: '14px', border: '1px solid #c8c5b8', gap: '10px', flexWrap: 'wrap' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1 }}>
              <label style={{ fontSize: '13px', fontWeight: '700' }}>선택된 작업방:</label>
              <select 
                value={currentRoom?.id || ''} 
                onChange={(e) => {
                  const selected = workgroups.find(w => w.id === e.target.value);
                  if (selected) setCurrentRoom(selected);
                }}
                style={{ padding: '8px 12px', borderRadius: '8px', border: '1px solid #c2bfb3', fontSize: '13px', fontWeight: '700', background: '#f7f6f0', flex: 1 }}
              >
                {workgroups.map(w => (
                  <option key={w.id} value={w.id}>{w.workgroup_name} ({w.description === 'Done' ? '완료' : '진행 중'})</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: '8px' }}>
              <button onClick={handleToggleRoomStatus} style={{ padding: '8px 12px', background: currentRoom?.description === 'Done' ? '#10b981' : '#d4ed31', color: currentRoom?.description === 'Done' ? '#fff' : '#111', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}>
                {currentRoom?.description === 'Done' ? '✓ 완료됨' : '● 진행 중'}
              </button>
              <label style={{ padding: '8px 14px', background: '#1c1b18', color: '#fff', borderRadius: '8px', cursor: 'pointer', fontWeight: '600', fontSize: '12px', display: 'inline-block' }}>
                + 새 버전 MP3 올리기
                <input type="file" accept="audio/mpeg,.mp3" onChange={handleUploadTrack} style={{ display: 'none' }} />
              </label>
              <button onClick={() => handleDeleteWorkgroup(currentRoom?.id)} style={{ padding: '8px 12px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}>
                작업방 삭제
              </button>
            </div>
          </div>

          {currentRoom ? (
            <>
              {/* 멀티 트랙 플레이어 영역 */}
              <div style={{ background: portfolioTheme === 'dark' ? '#1e1e1e' : '#fff', padding: '20px', borderRadius: '14px', border: '1px solid #c8c5b8', marginBottom: '20px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '10px' }}>
                  <div>
                    <span style={{ fontSize: '11px', fontWeight: '700', color: '#2e605d' }}>{currentRoom.description === 'Done' ? 'WORK COMPLETED' : 'WORK IN PROGRESS'} ✳</span>
                    <input 
                      type="text" 
                      value={currentRoom.workgroup_name} 
                      onChange={(e) => handleUpdateWorkgroupName(e.target.value)}
                      style={{ fontSize: '20px', fontWeight: '800', margin: '2px 0 0 0', padding: '4px 8px', border: '1px solid #c2bfb3', borderRadius: '6px', background: 'transparent', width: '320px' }}
                    />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button onClick={togglePlayAll} style={{ padding: '8px 16px', background: isPlaying ? '#e53935' : '#2e605d', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '13px' }}>
                      {isPlaying ? '⏸ 전체 일시정지' : '▶ 전체 재생'}
                    </button>
                    <span style={{ fontFamily: 'monospace', fontSize: '16px', fontWeight: '700' }}>
                      {formatTime(currentTime)} / {formatTime(duration)}
                    </span>
                  </div>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                  {currentRoom.tracks && currentRoom.tracks.length > 0 ? (
                    currentRoom.tracks.map((track, idx) => (
                      <div key={track.id} style={{ background: portfolioTheme === 'dark' ? '#252525' : '#f8fafc', padding: '14px', borderRadius: '10px', border: '1px solid #cbd5e1' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' }}>
                          <span style={{ fontSize: '13px', fontWeight: '700', color: '#2e605d' }}>
                            🎵 버전 v{idx + 1} : {track.track_name || track.filename}
                          </span>
                        </div>
                        <div ref={(el) => (containerRefs.current[track.id] = el)} style={{ width: '100%', borderRadius: '6px', overflow: 'hidden', background: '#fff', cursor: 'pointer' }} />
                      </div>
                    ))
                  ) : (
                    <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>등록된 음원 파일이 없습니다. 상단에서 MP3를 올려보세요!</div>
                  )}
                </div>
              </div>

              {/* 하단 세부 관리 탭 */}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px' }}>
                
                <div style={{ background: portfolioTheme === 'dark' ? '#1e1e1e' : '#fff', padding: '20px', borderRadius: '14px', border: '1px solid #c8c5b8' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
                    <h3 style={{ fontSize: '15px', fontWeight: '700', margin: 0 }}>⏱️ 지점 찍고 코멘트 남기기</h3>
                    <button 
                      onClick={handleToggleStamping}
                      style={{ padding: '6px 12px', background: isStamping ? '#2e605d' : '#e53935', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '12px', fontWeight: '700', cursor: 'pointer' }}
                    >
                      {isStamping ? '스탬프 켜기' : `지점 고정됨 (${formatTime(stampTime)}) - 재생 멈춤`}
                    </button>
                  </div>

                  <form onSubmit={handleAddComment} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <input type="text" value={authorName} onChange={(e) => setAuthorName(e.target.value)} placeholder="작성자 이름" style={{ padding: '8px', border: '1px solid #c2bfb3', borderRadius: '8px', fontSize: '12px', background: '#f7f6f0' }} required />
                    
                    <div>
                      <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '2px' }}>어느 트랙에 코멘트를 남길까요?</label>
                      <select 
                        value={selectedTrackId} 
                        onChange={(e) => setSelectedTrackId(e.target.value)} 
                        style={{ padding: '8px', border: '1px solid #c2bfb3', borderRadius: '8px', fontSize: '12px', background: '#f7f6f0', width: '100%', fontWeight: 'bold' }}
                        required
                      >
                        {currentRoom.tracks?.map((track, idx) => (
                          <option key={track.id} value={track.id}>
                            버전 v{idx + 1} : {track.track_name || track.filename}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label style={{ fontSize: '11px', color: '#666', display: 'block', marginBottom: '2px' }}>타임라인 위치 (초 단위 수동 수정 가능)</label>
                      <input 
                        type="number" 
                        step="0.1"
                        value={!isStamping ? stampTime : Number(currentTime.toFixed(2))} 
                        onChange={(e) => {
                          const val = parseFloat(e.target.value) || 0;
                          if (!isStamping) setStampTime(val);
                          else handleSeek(val);
                        }} 
                        style={{ padding: '8px', border: '1px solid #c2bfb3', borderRadius: '8px', fontSize: '12px', background: '#f7f6f0', width: '100%', fontFamily: 'monospace', fontWeight: 'bold' }} 
                        required 
                      />
                    </div>

                    <textarea 
                      ref={commentInputRef} 
                      value={newCommentText} 
                      onChange={(e) => setNewCommentText(e.target.value)} 
                      placeholder="이 순간, 어떤 소리가 들리나요?" 
                      style={{ height: '70px', padding: '8px', border: '1px solid #c2bfb3', borderRadius: '8px', fontSize: '12px', resize: 'none', background: '#f7f6f0' }} 
                      required 
                    />
                    <button type="submit" style={{ padding: '10px', background: '#1c1b18', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer', fontSize: '12px' }}>
                      코멘트 남기기
                    </button>
                  </form>
                </div>

                <div style={{ background: portfolioTheme === 'dark' ? '#1e1e1e' : '#fff', padding: '20px', borderRadius: '14px', border: '1px solid #c8c5b8', display: 'flex', flexDirection: 'column', height: '380px' }}>
                  <h3 style={{ fontSize: '15px', fontWeight: '700', margin: '0 0 10px 0' }}>📋 피드백 목록 관리 ({comments.filter(c => currentRoom.tracks?.some(t => t.id === c.track_id)).length})</h3>
                  <div style={{ overflowY: 'auto', flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', paddingRight: '4px' }}>
                    {comments.filter(c => currentRoom.tracks?.some(t => t.id === c.track_id)).length === 0 ? (
                      <div style={{ textAlign: 'center', opacity: 0.6, fontSize: '13px', marginTop: '100px' }}>
                        이 작업방에 등록된 코멘트가 없습니다.
                      </div>
                    ) : (
                      comments.filter(c => currentRoom.tracks?.some(t => t.id === c.track_id)).map((c) => {
                        const targetTrack = currentRoom.tracks?.find(t => t.id === c.track_id);
                        const trackLabel = targetTrack ? targetTrack.track_name : '기본 트랙';

                        return (
                          <div key={c.id} onClick={() => handleSeek(Number(c.start_time || 0))} style={{ padding: '10px', background: portfolioTheme === 'dark' ? '#252525' : '#f7f6f0', borderRadius: '8px', border: '1px solid #c2bfb3', display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }}>
                            <div>
                              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', marginBottom: '2px', flexWrap: 'wrap' }}>
                                <span style={{ fontSize: '11px', background: '#2e605d', color: '#fff', padding: '1px 5px', borderRadius: '4px', fontWeight: '700' }}>{trackLabel}</span>
                                <span style={{ fontSize: '12px', fontWeight: '700', color: '#2e605d' }}>{c.author}</span>
                                <span style={{ fontSize: '10px', fontFamily: 'monospace', background: '#e2dfd2', color: '#333', padding: '1px 5px', borderRadius: '4px' }}>{formatTime(c.start_time)}</span>
                                {c.resolved && <span style={{ fontSize: '10px', background: '#10b981', color: '#fff', padding: '1px 4px', borderRadius: '4px' }}>✓ 해결됨</span>}
                              </div>
                              <p style={{ fontSize: '12px', margin: 0, opacity: 0.9 }}>{c.content}</p>
                            </div>
                            <div style={{ display: 'flex', gap: '4px' }}>
                              <button onClick={(e) => { e.stopPropagation(); handleToggleResolve(c.id, c.resolved); }} style={{ padding: '4px 8px', background: c.resolved ? '#cbd5e1' : '#10b981', color: '#fff', border: 'none', borderRadius: '4px', fontSize: '10px', cursor: 'pointer', fontWeight: '600' }}>
                                {c.resolved ? '해결 취소' : '해결 완료'}
                              </button>
                              <button onClick={(e) => { e.stopPropagation(); handleDeleteComment(c.id); }} style={{ padding: '4px 8px', background: '#ef4444', color: '#fff', border: 'none', borderRadius: '6px', fontSize: '10px', cursor: 'pointer', fontWeight: '600' }}>
                                삭제
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                </div>

              </div>
            </>
          ) : (
            <div style={{ textAlign: 'center', padding: '60px', background: portfolioTheme === 'dark' ? '#1e1e1e' : '#fff', borderRadius: '14px', border: '1px solid #c8c5b8' }}>
              <p style={{ fontSize: '14px', opacity: 0.7, marginBottom: '15px' }}>선택된 작업방이 없습니다.</p>
              <button onClick={handleCreateWorkgroup} style={{ padding: '10px 18px', background: '#2e605d', color: '#fff', border: 'none', borderRadius: '8px', fontWeight: '700', cursor: 'pointer' }}>
                + 새 작업방 만들기
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}