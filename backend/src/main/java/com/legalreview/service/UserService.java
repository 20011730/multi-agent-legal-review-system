package com.legalreview.service;

import com.legalreview.domain.User;
import com.legalreview.domain.ReviewSession;
import com.legalreview.dto.request.AccountUpdateRequest;
import com.legalreview.dto.request.LoginRequest;
import com.legalreview.dto.request.SignupRequest;
import com.legalreview.dto.response.UserResponse;
import com.legalreview.repository.CompanyProfileRepository;
import com.legalreview.repository.ReviewSessionRepository;
import com.legalreview.repository.UserRepository;
import lombok.RequiredArgsConstructor;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
@RequiredArgsConstructor
public class UserService {

    private final UserRepository userRepository;
    private final CompanyProfileRepository companyProfileRepository;
    private final ReviewSessionRepository reviewSessionRepository;
    private final BCryptPasswordEncoder passwordEncoder;

    /**
     * 회원가입
     */
    @Transactional
    public UserResponse signup(SignupRequest request) {
        // 이메일 중복 검사
        if (userRepository.existsByEmail(request.getEmail())) {
            throw new IllegalArgumentException("이미 등록된 이메일 주소입니다");
        }

        User user = new User();
        user.setName(request.getName());
        user.setEmail(request.getEmail());
        user.setPassword(passwordEncoder.encode(request.getPassword()));
        String companyName = request.getCompanyName();
        user.setCompanyName(
                companyName != null && !companyName.isBlank() ? companyName.trim() : null);
        userRepository.save(user);

        return UserResponse.from(user);
    }

    /**
     * 로그인
     */
    @Transactional(readOnly = true)
    public UserResponse login(LoginRequest request) {
        User user = userRepository.findByEmail(request.getEmail())
                .orElseThrow(() -> new IllegalArgumentException("이메일 또는 비밀번호가 올바르지 않습니다"));

        if (!passwordEncoder.matches(request.getPassword(), user.getPassword())) {
            throw new IllegalArgumentException("이메일 또는 비밀번호가 올바르지 않습니다");
        }

        return UserResponse.from(user);
    }

    /**
     * 계정 기본 정보(이름) 수정
     */
    @Transactional
    public UserResponse updateAccount(Long userId, AccountUpdateRequest request) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다: " + userId));

        user.setName(request.getName().trim());
        userRepository.save(user);
        return UserResponse.from(user);
    }

    /**
     * 회원 탈퇴
     * - 회사 프로필 삭제
     * - 기존 세션은 user 참조만 해제(히스토리 데이터 보존)
     * - 사용자 삭제
     */
    @Transactional
    public void deleteAccount(Long userId) {
        User user = userRepository.findById(userId)
                .orElseThrow(() -> new IllegalArgumentException("사용자를 찾을 수 없습니다: " + userId));

        companyProfileRepository.findByUserId(userId)
                .ifPresent(companyProfileRepository::delete);

        for (ReviewSession session : reviewSessionRepository.findByUserIdOrderByCreatedAtDesc(userId)) {
            session.setUser(null);
        }

        userRepository.delete(user);
    }
}
