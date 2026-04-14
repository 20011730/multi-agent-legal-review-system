package com.legalreview.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;

@Configuration
public class RestTemplateConfig {

    @Bean
    public RestTemplate restTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        factory.setConnectTimeout(10000);       // 연결 타임아웃 10초
        factory.setReadTimeout(180000);         // 읽기 타임아웃 180초 (LangGraph AI 토론은 ~90초 소요)
        return new RestTemplate(factory);
    }
}
